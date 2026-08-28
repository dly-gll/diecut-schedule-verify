const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        process: "readonly", console: "readonly", __dirname: "readonly", __filename: "readonly",
        module: "readonly", require: "readonly", exports: "readonly", Buffer: "readonly",
        setTimeout: "readonly", setInterval: "readonly", clearTimeout: "readonly", clearInterval: "readonly",
        URL: "readonly", URLSearchParams: "readonly", fetch: "readonly", Response: "readonly", Request: "readonly", Headers: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-console": "off",
      "no-constant-condition": "warn",
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      "no-prototype-builtins": "warn",
      "no-undef": "error",
      "no-unreachable": "error",
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "warn",
      "curly": ["warn", "multi-line"],
      "no-throw-literal": "error",
      "no-new-wrappers": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-useless-escape": "warn"
    }
  },
  { ignores: ["node_modules/", "public/", "data.db*", "*.min.js", "dly-gll-review/"] }
];
