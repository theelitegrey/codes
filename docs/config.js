// Front-end config. With firebase set, the app reads monitor/events + monitor/wire
// from Firestore (refreshed each minute). Left null, it reads docs/data/*.json,
// which `npm run ingest` regenerates.
window.MONITOR_CONFIG = {
  firebase: null,
  // firebase: {
  //   apiKey: "...",
  //   authDomain: "your-project.firebaseapp.com",
  //   projectId: "your-project",
  // },
};
