const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("D:/diecut-schedule/dly-gll-review/package.json", "utf8"));

// Add ESLint as devDependency
pkg.devDependencies = {
  "@eslint/js": "^9.0.0",
  "eslint": "^9.0.0"
};

// Add lint scripts
pkg.scripts.lint = "eslint .";
pkg.scripts["lint:fix"] = "eslint . --fix";

fs.writeFileSync("D:/diecut-schedule/dly-gll-review/package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log("package.json updated");
