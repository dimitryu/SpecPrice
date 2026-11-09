// Stand-in for firebase-auth.js: remembers the auth callback so the test can
// "sign in" when it is ready.
export function getAuth(){ return { currentUser:null }; }
export function onAuthStateChanged(auth, cb){ globalThis.__authCb = async user => { auth.currentUser = user && {...user, getIdToken:async()=>'t'}; return cb(auth.currentUser); }; }
export async function signOut(){ }
export async function sendPasswordResetEmail(auth,email){ globalThis.__resetSent=email; }
export const EmailAuthProvider={ credential:(email,password)=>({email,password}) };
export async function reauthenticateWithCredential(user,cred){ if(cred.password!==(globalThis.__pw||'old-pass')){ const e=new Error('wrong'); e.code='auth/invalid-credential'; throw e; } }
export async function updatePassword(user,pw){ globalThis.__pw=pw; globalThis.__pwChanged=(globalThis.__pwChanged||0)+1; }
// Used by the sign-in page (web/index.html) only.
export const browserLocalPersistence={type:'LOCAL'};
export async function setPersistence(){ }
export async function signInWithEmailAndPassword(auth,email,pw){ if(pw!==(globalThis.__pw||'password1')){ const e=new Error('wrong'); e.code='auth/invalid-credential'; throw e; } return {user:{email}}; }
