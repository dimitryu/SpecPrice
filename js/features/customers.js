import { logAudit } from '../core/audit.js';
import { closeModal, esc, setActions, setContent, showModal, toast } from '../core/ui.js';
import { createCustomer, listCustomers, removeCustomerDoc, updateCustomer } from '../data/customers.js';
import { listProjects } from '../data/projects.js';
import { renderRFQDetail } from './rfq.js';

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ══════════════════════════════════════════════════════════════════════════════
export async function renderCustomers(){
  setActions(`<button class="btn btn-green" id="btn-new-cust">＋ New Customer</button>`);
  document.getElementById('btn-new-cust').addEventListener('click',()=>openCustomerModal());

  let customers=[], projects=[];
  try {
    [customers, projects]=await Promise.all([listCustomers(), listProjects()]);
  } catch(e){ setContent(`<p style="color:red;padding:20px">${e.message}</p>`); return; }

  if(!customers.length){
    setContent(`<div style="text-align:center;padding:80px;color:var(--muted)">
      <div style="font-size:48px;margin-bottom:12px">👥</div>
      <div>No customers yet. Click <strong>＋ New Customer</strong> to add one.</div></div>`);
    return;
  }

  setContent(`
    <div class="toolbar"><span class="count-badge">${customers.length} customers</span></div>
    <div class="card-grid">
    ${customers.map(c=>{
      const custRfqs=projects.filter(p=>p.customer_id===c._id);
      const iconHtml=c.icon_b64
        ? `<img src="${c.icon_b64}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0" alt="">`
        : `<div class="rfq-card-icon">🏢</div>`;
      return `
      <div class="rfq-card" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${iconHtml}
          <div class="rfq-card-body">
            <h3>${esc(c.name)}</h3>
            <p>${(c.contacts||[]).length} contact(s)</p>
            ${(c.contacts||[]).slice(0,2).map(ct=>`<p style="margin-top:2px;font-size:10px">${esc(ct.name)}${ct.email?' · '+esc(ct.email):''}</p>`).join('')}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-self:flex-start">
            <button class="btn btn-ghost btn-sm edit-cust" data-id="${c._id}">✏️ Edit</button>
            <button class="btn btn-red btn-sm del-cust" data-id="${c._id}" data-name="${esc(c.name)}">✕</button>
          </div>
        </div>
        ${custRfqs.length?`<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
          <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">RFQs (${custRfqs.length})</div>
          ${custRfqs.map(p=>`<div class="cust-rfq-link" data-id="${esc(p._id)}" data-name="${esc(p.name||p._id)}" style="font-size:11px;color:var(--blue-mid);cursor:pointer;padding:2px 0">📋 ${esc(p.name||p._id)}</div>`).join('')}
        </div>`:''}
      </div>`;
    }).join('')}
    </div>`);

  document.querySelectorAll('.edit-cust').forEach(btn=>btn.addEventListener('click',()=>{
    const c=customers.find(x=>x._id===btn.dataset.id); if(c) openCustomerModal(c);
  }));
  document.querySelectorAll('.del-cust').forEach(btn=>btn.addEventListener('click',()=>
    deleteCustomer(btn.dataset.id,btn.dataset.name)));
  document.querySelectorAll('.cust-rfq-link').forEach(el=>el.addEventListener('click',()=>{
    renderRFQDetail(el.dataset.id, el.dataset.name);
  }));
}

export function openCustomerModal(cust={}){
  const isEdit=!!cust._id;
  const contacts=(cust.contacts||[{name:'',email:'',phone:''}]);

  function contactRow(c={},i){
    return `<tr>
      <td><input class="form-input" style="padding:4px 7px;font-size:12px" placeholder="Full name" value="${esc(c.name||'')}" data-f="name" data-ci="${i}"></td>
      <td><input class="form-input" style="padding:4px 7px;font-size:12px" placeholder="email@…" value="${esc(c.email||'')}" data-f="email" data-ci="${i}"></td>
      <td><input class="form-input" style="padding:4px 7px;font-size:12px" placeholder="+972…" value="${esc(c.phone||'')}" data-f="phone" data-ci="${i}"></td>
      <td><button class="btn btn-red btn-sm del-contact" style="padding:3px 6px">✕</button></td>
    </tr>`;
  }

  showModal(`<div class="modal">
    <div class="modal-head"><h3>${isEdit?'Edit':'New'} Customer</h3><button class="close-modal" id="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-field">
        <label>Customer Name</label>
        <input class="form-input" id="cust-name-inp" placeholder="e.g. Elbit Systems" value="${esc(cust.name||'')}">

      </div>
      <div class="form-field">
        <label>Customer Icon</label>
        <div style="display:flex;align-items:center;gap:10px">
          <div id="cust-icon-preview" style="width:48px;height:48px;border-radius:8px;background:var(--blue-light);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
            ${cust.icon_b64?`<img src="${cust.icon_b64}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:22px">🏢</span>`}
          </div>
          <input type="file" id="cust-icon-inp" accept="image/*" style="font-size:12px">
          ${cust.icon_b64?`<button type="button" class="btn btn-ghost btn-sm" id="cust-icon-clear">Remove</button>`:''}
        </div>
      </div>
      <div style="margin-top:16px">
        <label style="font-size:12px;font-weight:600;color:var(--blue-dark)">Contacts</label>
        <table style="width:100%;margin-top:8px;font-size:12px">
          <thead><tr style="color:var(--muted)">
            <th style="padding:4px 6px;text-align:left">Name</th>
            <th style="padding:4px 6px;text-align:left">Email</th>
            <th style="padding:4px 6px;text-align:left">Phone</th>
            <th style="width:30px"></th>
          </tr></thead>
          <tbody id="contacts-tbody">
            ${contacts.map((c,i)=>contactRow(c,i)).join('')}
          </tbody>
        </table>
        <button class="btn btn-ghost btn-sm" id="btn-add-contact" style="margin-top:8px">＋ Add Contact</button>
      </div>
    </div>
    <div class="modal-foot" id="modal-foot-cust">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      ${isEdit?`<button class="btn btn-red btn-sm" id="btn-del-cust">Delete</button>`:''}
      <button class="btn btn-green" id="btn-save-cust">${isEdit?'Save Changes':'Create Customer'}</button>
    </div>
  </div>`);

  document.getElementById('modal-close').addEventListener('click',closeModal);
  document.getElementById('modal-cancel').addEventListener('click',closeModal);

  let contactCount=contacts.length;
  let _custIconB64=cust.icon_b64||'';

  document.getElementById('cust-icon-inp').addEventListener('change',()=>{
    const f=document.getElementById('cust-icon-inp').files[0];
    if(!f) return;
    const reader=new FileReader();
    reader.onload=e=>{
      _custIconB64=e.target.result;
      const prev=document.getElementById('cust-icon-preview');
      if(prev) prev.innerHTML=`<img src="${_custIconB64}" style="width:100%;height:100%;object-fit:cover">`;
    };
    reader.readAsDataURL(f);
  });
  document.getElementById('cust-icon-clear')?.addEventListener('click',()=>{
    _custIconB64='';
    const prev=document.getElementById('cust-icon-preview');
    if(prev) prev.innerHTML=`<span style="font-size:22px">🏢</span>`;
  });

  document.getElementById('btn-add-contact').addEventListener('click',()=>{
    const tb=document.getElementById('contacts-tbody');
    const row=document.createElement('tr');
    row.innerHTML=contactRow({},contactCount++).replace(/^<tr>/,'').replace(/<\/tr>$/,'');
    const tr=document.createElement('tr');
    tr.innerHTML=contactRow({name:'',email:'',phone:''},contactCount-1);
    tb.appendChild(tr);
    tr.querySelector('.del-contact').addEventListener('click',()=>tr.remove());
  });

  document.querySelectorAll('.del-contact').forEach(btn=>
    btn.addEventListener('click',()=>btn.closest('tr').remove()));

  document.getElementById('btn-save-cust').addEventListener('click',async()=>{
    const name=document.getElementById('cust-name-inp').value.trim();
    if(!name){ toast('Customer name is required','error'); return; }
    const rows=[...document.querySelectorAll('#contacts-tbody tr')];
    const custContacts=rows.map(tr=>({
      name:(tr.querySelector('[data-f="name"]')?.value||'').trim(),
      email:(tr.querySelector('[data-f="email"]')?.value||'').trim(),
      phone:(tr.querySelector('[data-f="phone"]')?.value||'').trim()
    })).filter(c=>c.name||c.email||c.phone);
    const btn=document.getElementById('btn-save-cust');
    btn.disabled=true; btn.textContent='Saving…';
    try{
      if(isEdit){
        await updateCustomer(cust._id,{name,contacts:custContacts,icon_b64:_custIconB64});
      } else {
        await createCustomer({name,contacts:custContacts,icon_b64:_custIconB64});
      }
      toast(isEdit?`Updated "${name}"`:`Customer "${name}" created`,'success');
      logAudit(isEdit?'customer_updated':'customer_created',{name},true);
      closeModal(); renderCustomers();
    }catch(e){ toast('Error: '+e.message,'error'); logAudit(isEdit?'customer_updated':'customer_created',{error:e.message},false); btn.disabled=false; btn.textContent=isEdit?'Save Changes':'Create Customer'; }
  });

  if(isEdit){
    document.getElementById('btn-del-cust')?.addEventListener('click',()=>{
      closeModal(); deleteCustomer(cust._id,cust.name);
    });
  }
}

export async function deleteCustomer(id,name){
  if(!confirm(`Delete customer "${name}"?`)) return;
  try{
    await removeCustomerDoc(id);
    toast(`Deleted "${name}"`,'success'); logAudit('customer_deleted',{name},true); renderCustomers();
  }catch(e){ toast('Error: '+e.message,'error'); logAudit('customer_deleted',{error:e.message},false); }
}
