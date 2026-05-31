const path = require("node:path");
const Mocha = require("mocha");
const { glob } = require("glob");

function run() {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 20000 });
  const testsRoot = path.resolve(__dirname);

  return glob("**/*.test.js", { cwd: testsRoot }).then(
    (files) =>
      new Promise((resolve, reject) => {
        for (const f of files) {
          mocha.addFile(path.resolve(testsRoot, f));
        }
        try {
          mocha.run((failures) => {
            if (failures > 0) {
              reject(new Error(`${failures} test(s) failed`));
            } else {
              resolve();
            }
          });
        } catch (err) {
          reject(err);
        }
      }),
  );
}

module.exports = { run };
