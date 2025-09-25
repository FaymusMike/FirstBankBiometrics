// app.js (type="module")
/*
  Single script to be used on:
    - index.html  (login / signup with email+password)  => elements (any of):
        - inputs: #authEmail, #authPassword   OR   #emailInput, #passwordInput
        - sign up button: #btnSignup
        - login form: #authForm (submit) or #btnLogin
    - dashboard.html (admin list)                  => elements: #userList (tbody), #btnLogout
    - enroll.html  (enrollment form + capture)     => elements: #enrollForm, #customerId, #fullName, #address, #phone,
                                                     #enrollVideo, #btnStartEnrollCam, #btnCaptureEnroll, #enrollStatus
    - verify.html  (search + live verify)          => elements: #verifySearch, #btnFind, #verifyVideo, #btnStartVerifyCam,
                                                     #btnCaptureVerify, #verifyStatus, #verifyResult

  Requirements:
    - Include TFJS & face-api.js script tags in HTML. Example (before this script):
      <script defer src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.8.0/dist/tf.min.js"></script>
      <script defer src="https://unpkg.com/face-api.js@0.22.2/dist/face-api.min.js"></script>

    - Host face-api models under /models (recommended) and set MODEL_URL = '/models'.
    - Add 'localhost' to Firebase Console -> Authentication -> Authorized domains if testing locally.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

/* ======= FIREBASE CONFIG - your config (unchanged) ======= */
const firebaseConfig = {
  apiKey: "AIzaSyDeRxX9CPkQ6q4_DQA9BzwvviVpTqvGs4o",
  authDomain: "firstbank-biometrics.firebaseapp.com",
  databaseURL: "https://firstbank-biometrics-default-rtdb.firebaseio.com",
  projectId: "firstbank-biometrics",
  storageBucket: "firstbank-biometrics.firebasestorage.app",
  messagingSenderId: "744204659741",
  appId: "1:744204659741:web:5a621948119ca5d68e2af4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ======= Face API model settings ======= */
const MODEL_URL = '/models'; // host models locally in /models for reliability
const MATCH_THRESHOLD = 0.52; // tune for your environment

/* ======= Small helpers ======= */
const $ = id => document.getElementById(id);
const exists = id => !!$(id);

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function captureCanvasFromVideo(videoEl, targetWidth = 480){
  const vw = videoEl.videoWidth || 640;
  const vh = videoEl.videoHeight || 480;
  const scale = targetWidth / vw;
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  return c;
}

function canvasRegionToThumbDataUrl(canvas, box, size=128, quality=0.65){
  const tmp = document.createElement('canvas');
  tmp.width = size; tmp.height = size;
  const ctx = tmp.getContext('2d');
  if(!box || box.width <= 0){
    ctx.drawImage(canvas, 0, 0, size, size);
  } else {
    ctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, size, size);
  }
  return tmp.toDataURL('image/jpeg', quality);
}

function descriptorToArray(desc){ return Array.from(desc); }
function arrayToFloat32(arr){ return Float32Array.from(arr); }
function euclideanDistance(a,b){
  let sum = 0;
  for(let i=0;i<a.length;i++){ const d = a[i]-b[i]; sum += d*d; }
  return Math.sqrt(sum);
}

/* ======= Load face models (non-blocking) ======= */
let faceModelsLoaded = false;
async function loadFaceModels(){
  if(typeof faceapi === 'undefined'){
    console.warn('face-api.js not found. Make sure you included the face-api script tag in HTML.');
    return;
  }
  try{
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceModelsLoaded = true;
    console.log('Face models loaded from', MODEL_URL);
  }catch(err){
    console.error('Failed to load face models from', MODEL_URL, err);
  }
}
loadFaceModels(); // fire & forget

/* ======= AUTH: Email + Password (signup, login, logout) =========
   Behavior:
    - Sign up: createUserWithEmailAndPassword -> automatically creates admins/{uid} doc
    - Login: signInWithEmailAndPassword
    - Logout: signOut
    - This design makes every new signup an admin automatically (per your request)
*/
(function wireAuthUI(){
  // support multiple possible id names (makes it robust to different index.html versions)
  const emailInput = $('authEmail') || $('emailInput') || $('loginEmail') || null;
  const passwordInput = $('authPassword') || $('passwordInput') || $('loginPassword') || null;
  const btnSignup = $('btnSignup') || $('signupBtn') || null;
  const authForm = $('authForm') || $('loginForm') || null;
  const btnLogin = $('btnLogin') || null;
  const btnLogout = $('btnLogout') || null;

  // Signup button (if present)
  if(btnSignup){
    btnSignup.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (emailInput && emailInput.value) ? emailInput.value.trim() : prompt('Enter email for signup');
      const password = (passwordInput && passwordInput.value) ? passwordInput.value : prompt('Enter password for signup (min 6 chars)');
      if(!email || !password){ return alert('Email and password required'); }
      try{
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        // automatically add this user as admin in Firestore
        await setDoc(doc(db, 'admins', userCred.user.uid), {
          uid: userCred.user.uid,
          email: email,
          role: 'admin',
          createdAt: new Date().toISOString()
        });
        alert('Signup successful. You are created as admin. Redirecting to dashboard...');
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('Signup error', err);
        alert('Signup failed: ' + (err.message || err));
      }
    });
  }

  // Login via form submit (preferred)
  if(authForm){
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (emailInput && emailInput.value) ? emailInput.value.trim() : '';
      const password = (passwordInput && passwordInput.value) ? passwordInput.value : '';
      if(!email || !password){ return alert('Enter email and password'); }
      try{
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('Login error', err);
        alert('Login failed: ' + (err.message || err));
      }
    });
  } else if(btnLogin){
    // fallback button-based login
    btnLogin.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = (emailInput && emailInput.value) ? emailInput.value.trim() : prompt('Enter email');
      const password = (passwordInput && passwordInput.value) ? passwordInput.value : prompt('Enter password');
      if(!email || !password) return alert('Enter email and password');
      try{
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('Login error', err);
        alert('Login failed: ' + (err.message || err));
      }
    });
  }

  // Logout wiring (dashboard logout button)
  if(btnLogout){
    btnLogout.addEventListener('click', async () => {
      try{
        await signOut(auth);
        window.location.href = 'index.html';
      }catch(err){
        console.error('Sign out error', err);
        alert('Sign out failed');
      }
    });
  }
})();

/* ======= Helper: check admin in admins collection (returns boolean) ======= */
async function checkIsAdmin(uid){
  if(!uid) return false;
  try{
    const adminDoc = await getDoc(doc(db, 'admins', uid));
    return adminDoc.exists();
  }catch(err){
    console.error('checkIsAdmin error', err);
    return false;
  }
}

/* ======= Auth state listener: enforce admin-only pages ======= */
onAuthStateChanged(auth, async (user) => {
  const page = window.location.pathname.split('/').pop();
  const protectedPages = ['dashboard.html', 'enroll.html', 'verify.html'];
  if(!user){
    // if on protected page and not signed in → redirect to index
    if(protectedPages.includes(page)){
      window.location.href = 'index.html';
    }
    return;
  }

  // If a user just signed up, we created admins/{uid}. But still check so old accounts without admin doc are denied.
  const isAdmin = await checkIsAdmin(user.uid);
  if(!isAdmin && protectedPages.includes(page)){
    alert('Access denied — only admin accounts can use this area. (For this project, signup automatically creates admin docs. If you need to grant admin externally, create admins/{uid} in Firestore.)');
    await signOut(auth);
    window.location.href = 'index.html';
    return;
  }

  // init page-specific logic for allowed admin pages
  if(page === 'dashboard.html') initDashboardPage();
  if(page === 'enroll.html') initEnrollPage();
  if(page === 'verify.html') initVerifyPage();
});

/* ======= DASHBOARD PAGE ======= */
async function initDashboardPage(){
  const tbody = $('userList');
  const btnLogout = $('btnLogout');
  if(btnLogout) btnLogout.onclick = async () => { await signOut(auth); window.location.href = 'index.html'; };

  async function loadCustomers(){
    if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    try{
      const snaps = await getDocs(collection(db, 'customers'));
      const rows = [];
      snaps.forEach(s => rows.push({ id: s.id, ...s.data() }));
      if(rows.length === 0){
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No enrollments yet</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.customerId || r.id}</td>
          <td>${r.fullName || ''}</td>
          <td>${r.phone || ''}</td>
          <td><img src="${r.imageDataUrl || ''}" style="width:64px;height:64px;object-fit:cover;border-radius:8px" /></td>
          <td>
            <button class="btn btn-sm btn-outline-primary view-btn" data-id="${r.id}">View</button>
            <button class="btn btn-sm btn-warning reenroll-btn" data-id="${r.id}">Re-enroll</button>
            <button class="btn btn-sm btn-danger delete-btn" data-id="${r.id}">Delete</button>
          </td>`;
        tbody.appendChild(tr);
      });

      // wire actions
      tbody.querySelectorAll('.view-btn').forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        const d = await getDoc(doc(db, 'customers', id));
        if(!d.exists()) return alert('Not found');
        const data = d.data();
        const w = window.open('');
        w.document.title = `Preview - ${data.fullName || id}`;
        w.document.body.innerHTML = `<div style="font-family:Inter,Arial;margin:12px">
          <h3>${data.fullName || id}</h3>
          <img src="${data.imageDataUrl || ''}" style="width:220px;height:220px;object-fit:cover;border-radius:8px"/>
          <p>${data.address || ''}</p>
          <p>${data.phone || ''}</p>
        </div>`;
      });

      tbody.querySelectorAll('.reenroll-btn').forEach(b => b.onclick = () => {
        const id = b.dataset.id;
        window.location.href = `enroll.html?id=${encodeURIComponent(id)}`;
      });

      tbody.querySelectorAll('.delete-btn').forEach(b => b.onclick = async () => {
        const id = b.dataset.id;
        if(!confirm(`Delete enrollment ${id}? This cannot be undone.`)) return;
        await deleteDoc(doc(db, 'customers', id));
        alert('Deleted.');
        loadCustomers();
      });

    }catch(err){
      console.error('loadCustomers error', err);
      if(tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-danger">Failed to load. Check console.</td></tr>';
    }
  }

  await loadCustomers();
}

/* ======= ENROLL PAGE ======= */
async function initEnrollPage(){
  // expected ids in enroll.html:
  // #enrollForm, #customerId, #fullName, #address, #phone, #enrollVideo, #btnStartEnrollCam, #btnCaptureEnroll, #enrollStatus
  const form = $('enrollForm');
  const customerIdEl = $('customerId');
  const fullNameEl = $('fullName');
  const addressEl = $('address');
  const phoneEl = $('phone');
  const videoEl = $('enrollVideo');
  const btnStartCam = $('btnStartEnrollCam');
  const btnCapture = $('btnCaptureEnroll');
  const statusEl = $('enrollStatus');

  // prefill when ?id= present (re-enroll)
  const params = new URLSearchParams(window.location.search);
  const preId = params.get('id');
  if(preId){
    const snap = await getDoc(doc(db,'customers', preId));
    if(snap.exists()){
      const data = snap.data();
      if(customerIdEl) customerIdEl.value = data.customerId || preId;
      if(fullNameEl) fullNameEl.value = data.fullName || '';
      if(addressEl) addressEl.value = data.address || '';
      if(phoneEl) phoneEl.value = data.phone || '';
      if(statusEl) statusEl.textContent = 'Loaded existing record for re-enroll. Capture and Save to overwrite.';
    }
  }

  let stream = null;
  if(btnStartCam){
    btnStartCam.onclick = async () => {
      try{
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        videoEl.srcObject = stream;
        await videoEl.play();
        if(statusEl) statusEl.textContent = 'Camera started';
      }catch(err){
        console.error('Camera error', err);
        if(statusEl) statusEl.textContent = 'Camera error: ' + (err.message || err);
      }
    };
  }

  if(btnCapture){
    btnCapture.onclick = async () => {
      if(!faceModelsLoaded){
        alert('Face models not loaded yet — wait a moment and try again.');
        return;
      }
      if(!customerIdEl.value || !fullNameEl.value){ alert('Customer ID and Full name required'); return; }
      if(!videoEl.srcObject){ alert('Start camera first'); return; }

      if(statusEl) statusEl.textContent = 'Capturing frame...';
      const canvas = captureCanvasFromVideo(videoEl, 480);

      if(statusEl) statusEl.textContent = 'Detecting face...';
      const detection = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();
      if(!detection){ if(statusEl) statusEl.textContent = 'No face detected — try again with better lighting'; return; }

      // make small thumbnail from face box
      const thumb = canvasRegionToThumbDataUrl(canvas, detection.detection.box, 128, 0.65);
      const descriptorArr = descriptorToArray(detection.descriptor);

      const docId = (customerIdEl.value || '').trim();
      const docData = {
        customerId: docId,
        fullName: (fullNameEl.value || '').trim(),
        address: (addressEl.value || '').trim(),
        phone: (phoneEl.value || '').trim(),
        imageDataUrl: thumb,
        descriptor: descriptorArr,
        enrolledAt: new Date().toISOString(),
        enrolledBy: (auth.currentUser && auth.currentUser.email) || 'unknown'
      };

      // Save to Firestore (doc id = customerId)
      try{
        await setDoc(doc(db, 'customers', docId), docData);
        if(statusEl) statusEl.textContent = 'Enrolled successfully.';
        alert('Enrolled: ' + docData.fullName);
        window.location.href = 'dashboard.html';
      }catch(err){
        console.error('save error', err);
        if(statusEl) statusEl.textContent = 'Failed to save: ' + (err.message || err);
      }
    };
  }
}

/* ======= VERIFY PAGE ======= */
async function initVerifyPage(){
  // expected elements:
  // #verifySearch, #btnFind, #verifyVideo, #btnStartVerifyCam, #btnCaptureVerify, #verifyStatus, #verifyResult
  const searchEl = $('verifySearch');
  const btnFind = $('btnFind');
  const videoEl = $('verifyVideo');
  const btnStartCam = $('btnStartVerifyCam');
  const btnCapture = $('btnCaptureVerify');
  const statusEl = $('verifyStatus');
  const resultEl = $('verifyResult');

  let selectedCandidate = null;
  let stream = null;

  if(btnFind){
    btnFind.onclick = async () => {
      const q = (searchEl.value || '').trim();
      if(!q){ alert('Enter Customer ID or name'); return; }
      // try direct id
      const snap = await getDoc(doc(db, 'customers', q));
      if(snap.exists()){
        selectedCandidate = { id: snap.id, ...snap.data() };
      } else {
        // fallback: search all and find by name substring
        const all = [];
        const snaps = await getDocs(collection(db, 'customers'));
        snaps.forEach(s => all.push({ id: s.id, ...s.data() }));
        selectedCandidate = all.find(c => (c.customerId && c.customerId.toLowerCase() === q.toLowerCase())
                                        || (c.fullName && c.fullName.toLowerCase().includes(q.toLowerCase())));
      }

      if(!selectedCandidate){
        statusEl.textContent = 'No record found.';
        resultEl.innerHTML = '';
        return;
      }

      statusEl.textContent = `Selected: ${selectedCandidate.fullName || selectedCandidate.id}`;
      resultEl.innerHTML = `<div style="display:flex;gap:12px;align-items:center">
        <img src="${selectedCandidate.imageDataUrl || ''}" style="width:140px;height:140px;object-fit:cover;border-radius:8px"/>
        <div><strong>${selectedCandidate.fullName}</strong><div>${selectedCandidate.phone || ''}</div><div>${selectedCandidate.address || ''}</div></div>
      </div>`;
    };
  }

  if(btnStartCam){
    btnStartCam.onclick = async () => {
      try{
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio:false });
        videoEl.srcObject = stream;
        await videoEl.play();
        statusEl.textContent = 'Camera started';
      }catch(err){
        console.error('camera error', err);
        statusEl.textContent = 'Camera error';
      }
    };
  }

  if(btnCapture){
    btnCapture.onclick = async () => {
      if(!selectedCandidate){ alert('Search and select a candidate first'); return; }
      if(!faceModelsLoaded){ alert('Face models not loaded yet — wait a bit and try again'); return; }
      if(!videoEl.srcObject){ alert('Start camera first'); return; }

      statusEl.textContent = 'Capturing...';
      const canvas = captureCanvasFromVideo(videoEl, 480);
      statusEl.textContent = 'Detecting face...';
      const det = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceLandmarks().withFaceDescriptor();
      if(!det){ statusEl.textContent = 'No face detected'; return; }

      const liveDesc = det.descriptor;
      const dbDescArr = selectedCandidate.descriptor || selectedCandidate.descriptors || [];
      if(!dbDescArr || !dbDescArr.length){ statusEl.textContent = 'Selected candidate has no stored descriptor'; return; }
      const dbDesc = arrayToFloat32(dbDescArr);

      const dist = euclideanDistance(liveDesc, dbDesc);
      if(dist < MATCH_THRESHOLD){
        statusEl.innerHTML = `MATCH ✅ — ${selectedCandidate.fullName} (dist=${dist.toFixed(3)})`;
      } else {
        statusEl.innerHTML = `NO MATCH ❌ (dist=${dist.toFixed(3)}) — try better lighting or re-enroll`;
      }
    };
  }

}

/* ======= Helpful console note for beginner admin setup (now automatic on signup) ======= */
console.log('app.js loaded — email/password auth enabled. Sign up creates admins/{uid} automatically.');
