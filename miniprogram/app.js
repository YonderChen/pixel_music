App({
  globalData: {currentScore: null},
  onLaunch() { require('./lib/files').clean(); },
  onHide() { require('./lib/engine').cancel(); }
});
