import {
// app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === Sign Up Function ===
async function signUp(email, password, fullName) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // Save user data in "users" collection
    await setDoc(doc(db, "users", uid), {
      fullName: fullName,
      email: email,
      verified: false,
      enrolled: false
    });

    alert("User registered successfully!");
  } catch (error) {
    alert(error.message);
  }
}

// === Login Function ===
async function login(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("Logged in!");
  } catch (error) {
    alert(error.message);
  }
}

// === Enroll Function ===
async function enrollUser(uid) {
  try {
    await setDoc(doc(db, "users", uid), { enrolled: true }, { merge: true });
    alert("User enrolled successfully!");
  } catch (error) {
    alert(error.message);
  }
}

// === Verify Function ===
async function verifyUser(uid) {
  try {
    await setDoc(doc(db, "users", uid), { verified: true }, { merge: true });
    alert("User verified successfully!");
  } catch (error) {
    alert(error.message);
  }
}

// === Delete User Function ===
async function deleteUser(uid) {
  try {
    await deleteDoc(doc(db, "users", uid));
    alert("User deleted successfully!");
  } catch (error) {
    alert(error.message);
  }
}

// === Check Admin Role ===
async function isAdmin(uid) {
  const adminRef = doc(db, "admins", uid);
  const adminSnap = await getDoc(adminRef);
  return adminSnap.exists();
}

// === Auth State Listener ===
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const uid = user.uid;
    const admin = await isAdmin(uid);

    if (admin) {
      console.log("You are an admin ✅");
      // Show admin UI (buttons for enroll, verify, delete, etc.)
      document.getElementById("adminPanel").style.display = "block";
    } else {
      console.log("You are a normal user 👤");
      document.getElementById("adminPanel").style.display = "none";
    }
  } else {
    console.log("No user logged in");
    document.getElementById("adminPanel").style.display = "none";
  }
});

// === Logout Function ===
function logout() {
  signOut(auth).then(() => {
    alert("Logged out!");
  }).catch((error) => {
    alert(error.message);
  });
}

// Export functions to use in HTML buttons
window.signUp = signUp;
window.login = login;
window.logout = logout;
window.enrollUser = enrollUser;
window.verifyUser = verifyUser;
window.deleteUser = deleteUser;
