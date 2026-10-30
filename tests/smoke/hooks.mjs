const MAP={ 'firebase-app.js':'./firebase-app.mjs', 'firebase-auth.js':'./firebase-auth.mjs', 'firebase-firestore.js':'./firebase-firestore.mjs' };
export async function resolve(spec, ctx, next){
  if(spec.startsWith('https://www.gstatic.com/firebasejs/')){
    const f=spec.split('/').pop(); return { url:new URL(MAP[f], import.meta.url).href, shortCircuit:true };
  }
  return next(spec, ctx);
}
