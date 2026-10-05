import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { pinia } from "./stores/pinia";
import { initializeMotionPreferences, motionDirective } from "./motion";
import { pressFeedbackDirective } from "./pressFeedback";
import { capsuleFeedbackDirective } from "./capsuleFeedback";
import { initializeNotifications, disposeNotifications } from "./notifications";
import { initializeUiConfig, uiConfigClient } from "./notificationConfig";
import { initializeThemeValidation, themedControlDirective } from "./themeControls";
import "./styles/vendor/project1-app.css";
import "./styles/vendor/project1-small-window-theme.css";
import "./styles/mail-overrides.css";
import "./styles/mail-pages.css";
import "./styles/admin.css";
import "./styles/motion.css";
import "./styles/intro.css";
import "./styles/login.css";
import "./styles/workspace.css";
import "./styles/notifications.css";
import "./styles/theme-controls.css";
import "./styles/search-motion.css";
import "./styles/reader.css";
import "./styles/dialogs.css";
import "./styles/local-theme.css";
import "./styles/dashed-accent.css";

initializeMotionPreferences();
initializeThemeValidation();
initializeNotifications();
const disposeUiConfig = initializeUiConfig();
const disposeConfigBoundary = router.afterEach(() => { void uiConfigClient.refresh(); });

const app = createApp(App)
  .use(pinia)
  .use(router)
  .directive("motion", motionDirective)
  .directive("press-feedback", pressFeedbackDirective)
  .directive("capsule-notice", capsuleFeedbackDirective)
  .directive("theme-control", themedControlDirective);
app.onUnmount(() => { disposeUiConfig(); disposeConfigBoundary(); disposeNotifications(); });
window.addEventListener('pagehide', event => {
  if (!event.persisted) { disposeUiConfig(); disposeConfigBoundary(); disposeNotifications(); }
});
app.mount("#app");
