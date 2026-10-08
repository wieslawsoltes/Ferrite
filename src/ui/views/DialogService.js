import {Dom} from './Dom.js';
/** Small promise-based modal boundary; all data insertion uses textContent. */
export class DialogService {
  static ask({title,label,value='',message='',confirm='Apply',input=true,danger=false}){
    return new Promise(resolve=>{const dialog=Dom.element('dialog','form-dialog'),form=Dom.element('form');form.method='dialog';form.append(Dom.element('h2','',title));if(message)form.append(Dom.element('p','dialog-copy',message));let field=null;
      if(input){const wrapper=Dom.element('label','field-label',label);field=Dom.element('input','text-field');field.value=value;field.name='value';field.required=true;wrapper.append(field);form.append(wrapper);}
      const actions=Dom.element('div','dialog-actions');const cancel=Dom.button('Cancel',()=>dialog.close());const ok=Dom.button(confirm,null,{className:danger?'danger-button':'primary-button'});ok.type='submit';actions.append(cancel,ok);form.append(actions);dialog.append(form);document.body.append(dialog);
      let answer=null;form.addEventListener('submit',e=>{e.preventDefault();answer=input?field.value:true;dialog.close();});dialog.addEventListener('close',()=>{dialog.remove();resolve(answer);},{once:true});dialog.showModal();field?.focus();field?.select();
    });
  }
}
