import { S } from './state.js';
import { currentUserRole } from './session.js';
import { listRoleDocs } from '../data/roles.js';

// Role → views visible as buttons on the Home screen.
//
// There is no permanent "built-in" class of role. SEED_ROLE_VIEWS is only what a
// brand-new installation STARTS with: the first time an admin opens
// Settings > Roles these are written to Firestore as ordinary documents, after
// which every role — seeded or created by hand — is listed, edited and deleted
// exactly the same way. Having two kinds of role that behaved differently was
// confusing and was the source of a real bug.
//
// The one exception is 'admin', and only because the alternative is
// unrecoverable: an admin who removes their own access to Settings and Admin,
// or deletes the admin role, locks administration out of the system permanently
// with no way back through the UI. So the admin ROLE cannot be deleted and
// cannot lose those two screens. Its name and everything else about it are
// editable like any other role.
export const SEED_ROLE_VIEWS = {
  admin:  ['rfq','sales-desk','part-stock','cut-strip','manufacturing','customers','statistics','settings','admin'],
  agent:  ['rfq','sales-desk','part-stock','cut-strip','manufacturing','customers'],
  // 'viewer' gets cut-strip too: the whole point of a cut & strip sheet is that
  // the person on the bench can pull it up, and a shop-floor account is exactly
  // the kind of read-only user 'viewer' exists for.
  viewer: ['part-stock','rfq','cut-strip'],
  sales:  ['sales-desk'],
};
export const PROTECTED_ROLE  = 'admin';
export const PROTECTED_VIEWS = ['settings','admin'];   // cannot be taken away from PROTECTED_ROLE
// Screens added in a later version than the role documents in Firestore. A role
// document is a snapshot of the screens that existed when it was written, so a
// new screen is invisible to everyone — including the administrator who would
// have to go and grant it — until someone edits the role. Administrators get
// those screens automatically; every other role is granted them by hand, as
// before. Unlike PROTECTED_VIEWS this is not a lock: an admin who doesn't want
// the screen can still set it to Disabled in Settings > Roles.
export const ADMIN_AUTO_VIEWS = ['statistics','manufacturing'];

// Seeding has to tell "this role has never been created" apart from "an admin
// deleted this role on purpose". Without that distinction you get one of two
// bugs: either deleted roles keep coming back, or an installation that already
// has SOME roles never gets the rest.
//
// A marker document records that the seed has run. Any doc id starting with an
// underscore is bookkeeping, never a role, and is filtered out everywhere roles
// are listed.
//
// NOT '__meta__': Firestore reserves every document id matching __.*__ and
// rejects the write outright ("Resource id is invalid because it is reserved").
// A single leading underscore is allowed and reads just as clearly.
export const ROLES_META_DOC = '_meta';
export const _isRoleDocId = id => !String(id||'').startsWith('_');
export async function loadRoles(){
  try{
    const docs = await listRoleDocs();
    const map = {};
    docs.forEach(d=>{
      if(d.id===ROLES_META_DOC){ S._rolesSeeded = d.data?.seeded===true; return; }
      if(_isRoleDocId(d.id)) map[d.id] = d.data;
    });
    S.roleViewsMap = map;
  }catch(e){ console.error('loadRoles', e); }
}
export function allowedViews(){
  const r = S.roleViewsMap[currentUserRole];
  let views = (r && Array.isArray(r.views)) ? r.views
            // Not in Firestore yet (fresh install, before the seed is written) or
            // the role was deleted while a user still had it. Either way, falling
            // back beats showing an empty Home screen with no way out.
            : (SEED_ROLE_VIEWS[currentUserRole] || SEED_ROLE_VIEWS['agent']);
  // Belt and braces on top of the save-time guard: however the admin role's
  // document ends up looking, an admin can always reach Settings and Admin.
  if(currentUserRole===PROTECTED_ROLE) views=[...new Set([...views, ...PROTECTED_VIEWS, ...ADMIN_AUTO_VIEWS])];
  return views;
}
// Screens a role can SEE but not open. A hidden screen tells a user nothing; a
// greyed-out one says "this exists, it isn't yours" — which is the honest answer
// when a feature is being rolled out, or belongs to another team. Disabled
// screens are never openable, so every access check treats them as closed.
export function disabledViews(){
  const r = S.roleViewsMap[currentUserRole];
  let list = (r && Array.isArray(r.disabledViews)) ? r.disabledViews : [];
  // An administrator locked out of Settings or Admin could not undo it, so those
  // two can never be disabled for the admin role however the document looks.
  if(currentUserRole===PROTECTED_ROLE) list = list.filter(v=>!PROTECTED_VIEWS.includes(v));
  return list;
}
export function isViewDisabled(v){ return disabledViews().includes(v); }
export function canView(v){
  if(v==='home') return true;
  return allowedViews().includes(v) && !isViewDisabled(v);
}
// Every role key the app knows about.
//
// Before the seed has been written, the seed roles exist conceptually even
// though they have no documents, so they are unioned in — otherwise they vanish
// from the Roles table and from every user-role dropdown, which is exactly what
// went wrong when the first custom role was created.
//
// After seeding, Firestore is the whole truth and the seed contributes nothing.
// That is what lets a deleted role stay deleted instead of reappearing on the
// next page load.
export function _mergedRoleKeys(){
  const saved=Object.keys(S.roleViewsMap).filter(_isRoleDocId);
  return S._rolesSeeded ? saved : [...new Set([...Object.keys(SEED_ROLE_VIEWS), ...saved])];
}
export function roleOptions(){
  return _mergedRoleKeys().map(k =>
    [k, (S.roleViewsMap[k] && S.roleViewsMap[k].name) || (k.charAt(0).toUpperCase()+k.slice(1))]);
}
