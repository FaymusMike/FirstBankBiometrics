// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";

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
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
