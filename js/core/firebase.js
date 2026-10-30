import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail }
                               from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, addDoc, arrayUnion, deleteField,
         updateDoc, deleteDoc, collection, query, where, orderBy, limit, serverTimestamp,
         writeBatch }
                               from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

// ── Firebase ──────────────────────────────────────────────────────────────────
export const FB = initializeApp({
  apiKey:"AIzaSyCyRRnbEE_h7KC5RieXiNcVAZv_aaiqNK4",
  authDomain:"specprice-236a2.firebaseapp.com",
  projectId:"specprice-236a2",
  storageBucket:"specprice-236a2.firebasestorage.app",
  messagingSenderId:"294680326166",
  appId:"1:294680326166:web:d3ef0602f2103c87b30537"
});
export const auth = getAuth(FB);
export const db   = getFirestore(FB);

export { initializeApp, getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail, getFirestore, doc, getDoc, getDocs, setDoc, addDoc, arrayUnion, deleteField, updateDoc, deleteDoc, collection, query, where, orderBy, limit, serverTimestamp, writeBatch };

