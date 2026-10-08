import {IdeApplication} from './IdeApplication.js';
try { new IdeApplication(); }
catch (error) {
  console.error(error);
  const status=document.getElementById('status');
  status.textContent=`Startup failed: ${error.message}`;status.dataset.kind='error';
}
