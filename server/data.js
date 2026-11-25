export const demo = {
  faculty:[
    {id:'F-001',name:'Dr. Ananya Rao',email:'ananya.rao@cse.edu',title:'Professor',department:'Computer Science',load:14,color:'violet'},
    {id:'F-002',name:'Prof. Rohan Mehta',email:'rohan.mehta@cse.edu',title:'Associate Professor',department:'Computer Science',load:12,color:'blue'},
    {id:'F-003',name:'Dr. Kavya Nair',email:'kavya.nair@cse.edu',title:'Assistant Professor',department:'Computer Science',load:16,color:'rose'},
    {id:'F-004',name:'Prof. Arjun Iyer',email:'arjun.iyer@cse.edu',title:'Assistant Professor',department:'Computer Science',load:10,color:'amber'},
    {id:'F-005',name:'Dr. Meera Shah',email:'meera.shah@cse.edu',title:'Associate Professor',department:'Computer Science',load:13,color:'teal'}
  ],
  tasks:[
    {id:'T-101',title:'Course file submission — Data Structures',facultyId:'F-001',category:'Academic',dueDate:'2026-11-28',status:'In progress',priority:'High',description:'Complete course file with lesson plans, attendance and assessment records.'},
    {id:'T-102',title:'NBA documentation · Criterion 3',facultyId:'F-002',category:'Accreditation',dueDate:'2026-11-30',status:'Not started',priority:'High',description:'Compile student performance and outcome attainment evidence.'},
    {id:'T-103',title:'Internal assessment marks upload',facultyId:'F-003',category:'Academic',dueDate:'2026-11-25',status:'Completed',priority:'Medium',description:'Upload verified internal assessment marks to the portal.'},
    {id:'T-104',title:'Department seminar coordination',facultyId:'F-004',category:'Administration',dueDate:'2026-12-03',status:'In progress',priority:'Medium',description:'Confirm speaker, room and student registrations.'},
    {id:'T-105',title:'Research advisory meeting minutes',facultyId:'F-005',category:'Research',dueDate:'2026-11-27',status:'Not started',priority:'Low',description:'Share signed minutes with the department office.'},
    {id:'T-106',title:'Lab equipment utilization report',facultyId:'F-001',category:'Administration',dueDate:'2026-12-05',status:'Completed',priority:'Low',description:'Submit semester utilization and maintenance report.'},
    {id:'T-107',title:'Project review panel schedule',facultyId:'F-003',category:'Academic',dueDate:'2026-12-01',status:'In progress',priority:'High',description:'Publish panel schedule for final year project reviews.'}
  ],
  responsibilities:[{id:'R-01',facultyId:'F-001',title:'Department timetable coordinator',type:'Administration'},{id:'R-02',facultyId:'F-002',title:'NBA criterion lead',type:'Accreditation'},{id:'R-03',facultyId:'F-003',title:'Project coordinator',type:'Academic'},{id:'R-04',facultyId:'F-004',title:'Seminar and events',type:'Administration'}]
};
