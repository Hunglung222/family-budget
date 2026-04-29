'use strict';
// ═══════════════════════════════════════════════════
//  auth.js — Firebase Auth 初始化與登入守衛
//  所有需要登入的頁面引入此檔即可，勿在各頁面重複寫
// ═══════════════════════════════════════════════════

(function () {
  const ALLOWED = ['kevin67222@gmail.com', 'gogosuperbird@gmail.com'];
  const FB_CFG = {
    apiKey: "AIzaSyA2FVuIV_5sMUxd851XhTcSMQIg0m1Lh6M",
    authDomain: "family-budget-aed64.firebaseapp.com",
    projectId: "family-budget-aed64",
    storageBucket: "family-budget-aed64.firebasestorage.app",
    messagingSenderId: "714512661107",
    appId: "1:714512661107:web:022f9c7f7b828b5eb9c806",
  };
  if (!firebase.apps.length) firebase.initializeApp(FB_CFG);
  firebase.auth().onAuthStateChanged(user => {
    if (!user || !ALLOWED.includes(user.email)) {
      window.location.replace('./login.html');
    } else {
      const name = user.email === 'kevin67222@gmail.com' ? '宏龍' : '盈慧';
      localStorage.setItem('current_user', name);
      localStorage.setItem('current_email', user.email);
      localStorage.setItem('current_uid', user.uid);
    }
  });
})();
