// Run before styles and the app load to avoid a flash of the wrong theme.
(() => {
  let preference;
  try {
    preference = localStorage.getItem("databricks-effect-app.theme.v1");
  } catch {
    // Storage may be blocked; fall back to the system theme.
  }
  const dark =
    preference === "Dark" ||
    (preference !== "Light" &&
      preference !== "Dark" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
