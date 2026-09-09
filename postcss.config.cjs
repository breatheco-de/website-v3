const path = require("path");

/** Explicit config path — Weblify cwd is PROJECT_ROOT, not PACKAGE_ROOT.
 * Use .cjs because package.json has "type": "module". */
module.exports = {
  plugins: {
    tailwindcss: {
      config: path.join(__dirname, "tailwind.config.cjs"),
    },
    autoprefixer: {},
  },
};
