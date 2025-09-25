// app.js (type="module")
import { auth, db, storage } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, collection, getDocs, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";

/* ------------------ DOM ------------------ */
const video = document.getElementById('video');
const btnStart = document.getElementById('btnStart');
const btnEnroll = document.getElementById('btnEnroll');
const btnVerify = document.getElementById('btnVerify');
const btnList = document.getElementById('btnList');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const accountIdInput = document.getElementById('accountId');
const modelStatus = document.getElementById('modelStatus');

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const btnSignIn = document.getElementById('btnSignIn');
const btnSignUp = document.getElementById('btnSignUp');
const btnSendLink = document.getElementById('btnSendLink');

const authCard = document.getElementById('authCard');
const profile = document.getElementById('profile');
const profileEmail = document.getElementById('profileEmail');
const profileRole = document.getElementById('profileRole');
const btnSignOut = document.getElementById('btnSignOut');
const navEmail = document.getElementById('navEmail');
const btnLogout = document.getElementById('btnLogout');

const adminCard = document.getElementById('adminCard');
const adminList = document.getElementById('adminList');

/* ------------------ tiny config ------------------ */
const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models/'; // public; you can host locally too
const THRESHOLD = 0.52; // matching threshold — tune with tests

// For prototype admin assignment: add emails here which should be admin by default.
// For production, use Firebase Admin SDK custom claims.
const DEFAULT_ADMIN_EMAILS = ['admin@firstbank.com']; // change to your admin email(s)

/* ------------------ face-api models ------------------ */
async function loadModels(){
  modelStatus.textContent = 'Loading models...';
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  modelStatus.textContent = 'Models loaded';
}
loadModels();

/* ------------------ camera ------------------ */
btnStart.onclick = async () => {
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio:false });
    video.srcObject = stream;
    status.textContent = 'Camera started';
  }catch(e){
    console.error(e);
    status.textContent = 'No camera or permission denied';
  }
};

function captureCanvas(width=480){
  const w = width;
  const h = Math.round(video.videoHeight / (video.videoWidth / w));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c;
}
function canvasToBlob(canvas, quality=0.8){
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}
function makeThumbDataUrl(canvas, box, size=128){
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  // if no box, draw full image scaled
  if(!box || box.width <=0){
    cx.drawImage(canvas, 0, 0, size, size);
  } else {
    cx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, size, size);
  }
  return c.toDataURL('image/jpeg', 0.6);
}

/* ------------------ enroll ------------------ */
btnEnroll.onclick = async () => {
  const accountId = (accountIdInput.value || '').trim();
  if(!accountId){ status.textContent = 'Enter an Account ID to enroll'; return; }
  status.textContent = 'Capturing...';

  const canvas = captureCanvas(480);
  const det = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({inputSize:224})).withFaceLandmarks().withFaceDescriptor();
  if(!det){ status.textContent = 'No face detected — try again'; return; }

  // preview
  preview.src = canvas.toDataURL('image/jpeg', 0.8);

  status.textContent = 'Uploading image & saving descriptor...';
  // upload full image -> storage
  const blob = await canvasToBlob(canvas, 0.8);
  const ts = Date.now();
  const storagePath = `faces/${accountId}_${ts}.jpg`;
  const sRef = ref(storage, storagePath);
  await uploadBytes(sRef, blob);
  const imageUrl = await getDownloadURL(sRef);

  // tiny thumbnail (base64) for quick UI in Firestore (keep tiny)
  const thumb = makeThumbDataUrl(canvas, det.detection.box, 128);

  const descriptorArr = Array.from(det.descriptor);

  // save into Firestore (doc id = accountId so re-enroll will overwrite)
  await setDoc(doc(db, 'faces', accountId), {
    accountId,
    imageUrl,
    storagePath,
    thumb,
    descriptor: descriptorArr,
    enrolledAt: new Date().toISOString()
  });

  status.textContent = 'Enrolled successfully';
  refreshAdminListIfVisible();
};

/* ------------------ verify ------------------ */
btnVerify.onclick = async () => {
  status.textContent = 'Capturing for verification...';
  const canvas = captureCanvas(480);
  const det = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({inputSize:224})).withFaceLandmarks().withFaceDescriptor();
  if(!det){ status.textContent = 'No face detected'; return; }

  status.textContent = 'Comparing with enrolled records...';
  const inputDesc = det.descriptor;

  const snap = await getDocs(collection(db, 'faces'));
  let best = { id: null, dist: Infinity, url: null };
  snap.forEach(d => {
    const data = d.data();
    if(!data.descriptor) return;
    const dbDesc = Float32Array.from(data.descriptor);
    let sum = 0;
    for(let i=0;i<dbDesc.length;i++){ const diff = dbDesc[i] - inputDesc[i]; sum += diff*diff; }
    const dist = Math.sqrt(sum);
    if(dist < best.dist){ best = { id: data.accountId, dist, url: data.imageUrl } }
  });

  if(best.id && best.dist < THRESHOLD){
    status.innerHTML = `Matched <strong>${best.id}</strong> (dist=${best.dist.toFixed(3)})`;
    preview.src = best.url;
  } else {
    status.textContent = 'No match found (try better lighting or re-enroll)';
  }
};

/* ------------------ admin: list / delete / re-enroll flow ------------------ */
async function renderAdminList(){
  adminList.innerHTML = '';
  const snap = await getDocs(collection(db, 'faces'));
  if(snap.empty){ adminList.innerHTML = '<div class="small text-muted">No enrollments</div>'; return; }

  snap.forEach(d => {
    const data = d.data();
    const row = document.createElement('div');
    row.className = 'user-row';
    row.innerHTML = `
      <img src="${data.thumb || data.imageUrl || ''}" alt="${data.accountId}" />
      <div style="flex:1">
        <div class="fw-bold">${data.accountId}</div>
        <div class="small text-muted">${data.enrolledAt ? new Date(data.enrolledAt).toLocaleString() : ''}</div>
      </div>
      <div class="d-flex gap-1">
        <button class="btn btn-sm btn-outline-primary btn-view" data-id="${data.accountId}">View</button>
        <button class="btn btn-sm btn-warning btn-reenroll" data-id="${data.accountId}">Re-enroll</button>
        <button class="btn btn-sm btn-danger btn-delete" data-id="${data.accountId}" data-path="${data.storagePath || ''}">Delete</button>
      </div>
    `;
    adminList.appendChild(row);
  });
}

async function refreshAdminListIfVisible(){
  if(!adminCard.classList.contains('d-none')) await renderAdminList();
}

btnList.onclick = async () => {
  await renderAdminList();
  status.textContent = 'Refreshed enrollments';
};

// delegate admin list clicks
adminList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.classList.contains('btn-view')){
    const docSnap = await getDoc(doc(db, 'faces', id));
    if(docSnap.exists()){
      const d = docSnap.data();
      preview.src = d.imageUrl;
      status.textContent = `Previewing ${id}`;
    }
  } else if(btn.classList.contains('btn-reenroll')){
    // simple UX: set accountId input and instruct admin to click Capture & Enroll
    accountIdInput.value = id;
    status.textContent = `Account ${id} selected — press "Capture & Enroll" to re-enroll`;
    // scroll to enroll side? left to browser behavior
  } else if(btn.classList.contains('btn-delete')){
    if(!confirm(`Delete enrollment for ${id}? This removes stored image & descriptor.`)) return;
    const storagePath = btn.dataset.path;
    try{
      if(storagePath){
        await deleteObject(ref(storage, storagePath));
      }
    }catch(err){
      console.warn('deleteObject may have failed (file might be absent)', err);
    }
    await deleteDoc(doc(db, 'faces', id));
    status.textContent = `${id} deleted`;
    await renderAdminList();
  }
});

/* ------------------ Auth flows ------------------ */
btnSignUp.onclick = async () => {
  const email = (emailInput.value || '').trim();
  const password = (passwordInput.value || '').trim();
  if(!email || !password){ alert('Enter email and password'); return; }
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // create a staff/user doc with role (for prototype)
    const role = DEFAULT_ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
    await setDoc(doc(db, 'staff', cred.user.uid), { uid: cred.user.uid, email, role, createdAt: new Date().toISOString() });
    alert('Sign-up success. You are signed in.');
  }catch(err){
    console.error(err);
    alert(err.message || 'Signup failed');
  }
};

btnSignIn.onclick = async () => {
  const email = (emailInput.value || '').trim();
  const password = (passwordInput.value || '').trim();
  if(!email || !password){ alert('Enter email and password'); return; }
  try{
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will update UI
  }catch(err){
    console.error(err);
    alert(err.message || 'Sign-in failed');
  }
};

// Passwordless: send sign-in link to email
btnSendLink.onclick = async () => {
  const email = (emailInput.value || '').trim();
  if(!email){ alert('Enter email to send link'); return; }
  const actionCodeSettings = {
    url: window.location.href,
    handleCodeInApp: true
  };
  try{
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem('emailForSignIn', email);
    alert('Sign-in link sent — check your email (and spam). Open the link to complete sign-in.');
  }catch(err){
    console.error(err);
    alert(err.message || 'Failed to send link');
  }
};

// on page load: handle incoming email link sign-in
window.addEventListener('load', async () => {
  // Wait until auth is available, then check link
  if(isSignInWithEmailLink(auth, window.location.href)){
    let email = window.localStorage.getItem('emailForSignIn');
    if(!email){
      email = prompt('Enter the email you used to sign in (to complete link sign-in)');
    }
    if(!email) return;
    try{
      await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
      alert('Signed in with email link');
    }catch(err){
      console.error(err);
      alert('Email link sign-in failed: ' + (err.message || ''));
    }
  }
});

/* ------------------ auth state UI & role handling ------------------ */
onAuthStateChanged(auth, async (user) => {
  if(user){
    authCard.classList.add('d-none');
    profile.classList.remove('d-none');
    navEmail.textContent = user.email;
    btnLogout.classList.remove('d-none');
    btnSignOut.classList.remove('d-none');

    // read staff doc for role
    const staffSnap = await getDoc(doc(db, 'staff', user.uid));
    let role = 'user';
    if(staffSnap.exists()){
      role = staffSnap.data().role || 'user';
    } else {
      // if not created earlier, create default
      const defaultRole = DEFAULT_ADMIN_EMAILS.includes(user.email) ? 'admin' : 'user';
      await setDoc(doc(db, 'staff', user.uid), { uid: user.uid, email: user.email, role: defaultRole, createdAt: new Date().toISOString() });
      role = defaultRole;
    }

    profileEmail.textContent = user.email;
    profileRole.textContent = role.toUpperCase();
    profileRole.className = role === 'admin' ? 'badge bg-success' : 'badge bg-secondary';

    if(role === 'admin'){
      adminCard.classList.remove('d-none');
      await renderAdminList();
    } else {
      adminCard.classList.add('d-none');
    }
  } else {
    authCard.classList.remove('d-none');
    profile.classList.add('d-none');
    navEmail.textContent = '';
    btnLogout.classList.add('d-none');
    adminCard.classList.add('d-none');
  }
});

btnSignOut.onclick = btnLogout.onclick = async () => {
  await signOut(auth);
  status.textContent = 'Signed out';
};

/* ------------------ small helpers ------------------ */
// expose a helper to refresh admin area if visible
window.refreshAdminListIfVisible = refreshAdminListIfVisible;
