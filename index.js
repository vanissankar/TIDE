import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import {demo} from './server/data.js';
import {getAll,saveAll,sheetsEnabled,initializeSheets,updateTaskStatus} from './server/sheets.js';
import {sendDeadlineReminders} from './server/reminders.js';

const app=express();
app.use(cors());
app.use(express.json());

// Initialize the configured spreadsheet once per server process/function instance.
let sheetsReady;
app.use(async(req,res,next)=>{
  if(req.path==='/api/health')return next();
  try{
    if(!sheetsReady)sheetsReady=initializeSheets();
    await sheetsReady;
    next();
  }catch(error){sheetsReady=undefined;next(error)}
});

const allowDemo=process.env.NODE_ENV!=='production'&&!sheetsEnabled;
const secret=process.env.JWT_SECRET||(process.env.NODE_ENV!=='production'?'local-demo-secret-change-me':'');
const accounts=[
  {email:process.env.HOD_EMAIL||(allowDemo?'hod@cse.edu':''),password:process.env.HOD_PASSWORD||(allowDemo?'hod123':''),name:process.env.HOD_NAME||'Dr. V. Sharmila',role:'HOD'},
  ...(allowDemo?demo.faculty.map(f=>({email:f.email,password:'faculty123',name:f.name,role:'Faculty',facultyId:f.id})):[])
].filter(a=>a.email&&a.password);
function verifyStoredPassword(password, encoded) {
  const [scheme, salt, expected] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  try {
    const actual=scryptSync(password,salt,Buffer.from(expected,'hex').length);
    return timingSafeEqual(actual,Buffer.from(expected,'hex'));
  } catch { return false; }
}
const auth=(roles=[]) => (req,res,next)=>{
  try{
    if(!secret)return res.status(503).json({error:'Server authentication is not configured.'});
    const token=(req.headers.authorization||'').replace('Bearer ','');
    req.user=jwt.verify(token,secret);
    if(roles.length&&!roles.includes(req.user.role))return res.status(403).json({error:'This action is not available for your role.'});
    next();
  }catch{return res.status(401).json({error:'Please sign in again.'})}
};

app.get('/api/health',(req,res)=>res.json({ok:true,database:sheetsEnabled?'google-sheets':'demo'}));
app.get('/api/config',(req,res)=>res.json({hodName:process.env.HOD_NAME||'Dr. V. Sharmila'}));
app.get('/api/cron/reminders',async(req,res)=>{
  if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`)return res.status(401).json({error:'Unauthorized.'});
  try{res.json({ok:true,...await sendDeadlineReminders({dryRun:req.query.dryRun==='true'})})}
  catch(error){console.error('Reminder job failed:',error.message);res.status(503).json({error:'Reminder job could not complete.'})}
});
app.post('/api/auth/login',async(req,res)=>{
  if(!secret){
    if(!allowDemo)return res.status(503).json({error:'Server authentication is not configured.'});
  }
  const {email,password}=req.body||{};
  let user=accounts.find(a=>a.email.toLowerCase()===String(email||'').toLowerCase()&&a.password===password);
  if(!user&&sheetsEnabled){
    try{
      const d=await getAll();
      const f=d.faculty.find(x=>[x.email,x.username].some(v=>String(v||'').toLowerCase()===String(email||'').toLowerCase()));
      const valid=f&&(f.passwordHash?verifyStoredPassword(password,f.passwordHash):Boolean(process.env.FACULTY_PASSWORD&&password===process.env.FACULTY_PASSWORD));
      if(valid)user={email:f.email||f.username,password,name:f.name,role:'Faculty',facultyId:f.id};
    }catch{}
  }else if(!user&&password===(process.env.FACULTY_PASSWORD||(allowDemo?'faculty123':''))){
    try{const d=await getAll();const f=d.faculty.find(x=>x.email.toLowerCase()===String(email||'').toLowerCase());if(f)user={email:f.email,password,name:f.name,role:'Faculty',facultyId:f.id}}catch{}
  }
  if(!user)return res.status(401).json({error:'Email or password is incorrect.'});
  const {password:_,...safe}=user;
  res.json({token:jwt.sign(safe,secret,{expiresIn:'12h'}),user:safe});
});
app.get('/api/data',auth(),async(req,res)=>{
  if(!sheetsEnabled&&process.env.NODE_ENV==='production')return res.status(503).json({error:'Google Sheets is not configured for this deployment.'});
  try{
    const data=await getAll();
    if(req.user.role==='Faculty'){
      data.tasks=data.tasks.filter(t=>(t.facultyIds||[t.facultyId]).includes(req.user.facultyId));
      data.faculty=data.faculty.filter(f=>f.id===req.user.facultyId);
      data.responsibilities=data.responsibilities.filter(r=>(r.facultyIds||[r.facultyId]).includes(req.user.facultyId));
    }
    res.json({...data,database:sheetsEnabled?'google-sheets':'demo'});
  }catch(e){res.status(503).json({error:`Could not read the spreadsheet: ${e.message}`})}
});
app.put('/api/tasks/:id/status',auth(['Faculty']),async(req,res)=>{
  if(!sheetsEnabled&&process.env.NODE_ENV==='production')return res.status(503).json({error:'Google Sheets is not configured for this deployment.'});
  const {status}=req.body||{};
  if(!['Not started','In progress','Completed'].includes(status))return res.status(400).json({error:'Invalid task status.'});
  try{
    const data=await getAll();
    const task=data.tasks.find(t=>t.id===req.params.id&&(t.facultyIds||[t.facultyId]).includes(req.user.facultyId));
    if(!task)return res.status(404).json({error:'Task not found.'});
    if(!await updateTaskStatus(req.params.id,req.user.facultyId,status))return res.status(404).json({error:'Task not found.'});
    res.json({task:{...task,status}});
  }catch(e){res.status(503).json({error:`Could not update task: ${e.message}`})}
});
app.put('/api/admin/data',auth(['HOD']),async(req,res)=>{
  if(!sheetsEnabled&&process.env.NODE_ENV==='production')return res.status(503).json({error:'Google Sheets is not configured for this deployment.'});
  try{
    const next=req.body;
    for(const key of ['faculty','tasks','responsibilities'])if(!Array.isArray(next[key]))return res.status(400).json({error:`${key} must be a list.`});
    await saveAll(next);res.json({ok:true});
  }catch(e){res.status(503).json({error:`Could not save spreadsheet data: ${e.message}`})}
});
app.use((err,req,res,next)=>{console.error('Request failed:',err.message);res.status(503).json({error:'The service is temporarily unavailable.'})});

export default app;
