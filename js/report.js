/*
 * report.js saving files from the browser
 */
window.HG = window.HG || {};
HG.report = HG.report || {};

// Save a file to the Downloads folder
HG.report.saveFile = function (filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};