// Stand-in for firebase-auth.js: remembers the auth callback so the test can
// "sign in" when it is ready.
export function getAuth(){ return { currentUser:null }; }
export function onAuthStateChanged(auth, cb){ globalThis.__authCb = async user => { auth.currentUser = user && {...user, getIdToken:async()=>'t'}; return cb(auth.currentUser); }; }
export async function signOut(){ }
export async function sendPasswordResetEmail(){ }
