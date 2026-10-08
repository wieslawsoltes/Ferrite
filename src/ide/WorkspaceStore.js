/** Small persistence boundary for virtual IDE projects. */
export class WorkspaceStore {
 constructor(key){this.key=key;}
 read(){try{const value=JSON.parse(localStorage.getItem(this.key)||"null");return value&&typeof value==="object"?value:null;}catch{return null;}}
 write(value){try{localStorage.setItem(this.key,JSON.stringify(value));return true;}catch{return false;}}
 clear(){try{localStorage.removeItem(this.key);}catch{}}
}
