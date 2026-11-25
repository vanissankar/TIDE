import 'dotenv/config';
import app from '../index.js';
const port=process.env.PORT||4000;
app.listen(port,()=>console.log(`API ready on http://localhost:${port} (Google Sheets or demo mode)`));
