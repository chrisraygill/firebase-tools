import * as path from "node:path";
import * as fs from "fs-extra";

import { expect } from "chai";
import * as functions from "firebase-functions";
import * as functionsv2 from "firebase-functions/v2";

import * as cli from "./cli";
import { Endpoint } from "../../src/deploy/functions/backend";

const FIREBASE_PROJECT = process.env.GCLOUD_PROJECT || "";
const FUNCTIONS_DIR = path.join(__dirname, "functions");
const FNS_COUNT = 12;

function genRandomId(n = 10): string {
  const charset = "abcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < n; i++) {
    id += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return id;
}

interface Opts {
  v1Opts: functions.RuntimeOptions;
  v2Opts: functionsv2.GlobalOptions;

  v1TqOpts: functions.tasks.TaskQueueOptions;
  v2TqOpts: functionsv2.tasks.TaskQueueOptions;

  v1IdpOpts: functions.auth.UserOptions;
  v2IdpOpts: functionsv2.identity.BlockingOptions;
}

async function setOpts(opts: Opts) {
  let stmt = "";
  for (const [name, opt] of Object.entries(opts)) {
    if (opt) {
      stmt += `export const ${name} = ${JSON.stringify(opt)};\n`;
    }
  }
  await fs.writeFile(path.join(FUNCTIONS_DIR, "options.js"), stmt);
}

async function listFns(stripId = "dvtuqrxfjr"): Promise<Record<string, Endpoint>> {
  const result = await cli.exec("functions:list", FIREBASE_PROJECT, ["--json"], __dirname, false);
  const output = JSON.parse(result.stdout);

  const eps: Record<string, Endpoint> = {};
  for (const ep of output.result as Endpoint[]) {
    const id = ep.id.replace(`${stripId}-`, "");
    if (ep.id === id) {
      // This endpoint is from another run. Ignore.
      continue;
    }
    eps[id] = ep;
  }
  return eps;
}

describe("firebase deploy", function (this) {
  this.timeout(1000_000);

  const RUN_ID = genRandomId();
  console.log(`TEST RUN: ${RUN_ID}`);

  before(async () => {
    expect(FIREBASE_PROJECT).to.not.be.empty;

    // write up index.js to import trigger definition using unique group identifier.
    // All exported functions will have name {hash}-{trigger} e.g. 'abcdefg-v1storage'.
    await fs.writeFile(
      path.join(FUNCTIONS_DIR, "index.js"),
      `export * as ${RUN_ID} from "./fns.js";`
    );
  });

  after(async () => {
    await fs.unlink(path.join(FUNCTIONS_DIR, "index.js"));
  });

  it("deploys functions with runtime options", async () => {
    const opts: Opts = {
      v1Opts: {
        memory: "128MB",
        maxInstances: 42,
        timeoutSeconds: 42,
      },
      v2Opts: {
        memory: "128MiB",
        maxInstances: 42,
        timeoutSeconds: 42,
        // TODO: Re-enable once https://github.com/firebase/firebase-tools/issues/4679 is fixed.
        // cpu: 2,
        concurrency: 42,
      },
      v1TqOpts: {
        retryConfig: {
          maxAttempts: 42,
          maxRetrySeconds: 42,
          maxBackoffSeconds: 42,
          maxDoublings: 42,
          minBackoffSeconds: 42,
        },
        rateLimits: {
          maxDispatchesPerSecond: 42,
          maxConcurrentDispatches: 42,
        },
      },
      v2TqOpts: {
        retryConfig: {
          maxAttempts: 42,
          maxRetrySeconds: 42,
          maxBackoffSeconds: 42,
          maxDoublings: 42,
          minBackoffSeconds: 42,
        },
        rateLimits: {
          maxDispatchesPerSecond: 42,
          maxConcurrentDispatches: 42,
        },
      },
      v1IdpOpts: {
        blockingOptions: {
          idToken: true,
          refreshToken: true,
          accessToken: false,
        },
      },
      v2IdpOpts: {
        idToken: true,
        refreshToken: true,
        accessToken: true,
      },
    };
    await setOpts(opts);

    const result = await cli.exec(
      "deploy",
      FIREBASE_PROJECT,
      ["--only", "functions", "--non-interactive", "--force"],
      __dirname,
      false
    );

    expect(result.stdout, "deploy result").to.match(/Deploy complete!/);

    const endpoints = await listFns(RUN_ID);
    expect(Object.keys(endpoints).length, "number of deployed functions").to.equal(FNS_COUNT);

    for (const e of Object.values(endpoints)) {
      expect(e).to.include({
        availableMemoryMb: 128,
        timeoutSeconds: 42,
        maxInstances: 42,
      });
      if (e.platform === "gcfv2") {
        expect(e).to.include({
          // TODO: Re-enable once https://github.com/firebase/firebase-tools/issues/4679 is fixed.
          // expect(e.cpu, `${id}.cpu`).to.equal(2);
          // cpu: 2,
          concurrency: 42,
        });
      }
      if ("taskQueueTrigger" in e) {
        expect(e.taskQueueTrigger).to.deep.equal({
          retryConfig: {
            maxAttempts: 42,
            maxRetrySeconds: 42,
            maxBackoffSeconds: 42,
            maxDoublings: 42,
            minBackoffSeconds: 42,
          },
          rateLimits: {
            maxDispatchesPerSecond: 42,
            maxConcurrentDispatches: 42,
          },
        });
      }
    }
  });

  it("leaves existing options when unspecified", async () => {
    await setOpts({
      v1Opts: {},
      v2Opts: {},
      v1TqOpts: {},
      v2TqOpts: {},
      v1IdpOpts: {},
      v2IdpOpts: {},
    });

    const result = await cli.exec(
      "deploy",
      FIREBASE_PROJECT,
      ["--only", "functions", "--non-interactive", "--force"],
      __dirname,
      false
    );

    expect(result.stdout, "deploy result").to.match(/Deploy complete!/);

    const endpoints = await listFns(RUN_ID);
    expect(Object.keys(endpoints).length, "number of deployed functions").to.equal(FNS_COUNT);

    for (const e of Object.values(endpoints)) {
      expect(e).to.include({
        availableMemoryMB: 128,
        // TODO: Fix bug where timeout is being updated, not inferred from existing.
        // timeoutSeconds: 42,
        maxInstances: 42,
      });
      if (e.platform === "gcfv2") {
        expect(e).to.include({
          // TODO: Re-enable once https://github.com/firebase/firebase-tools/issues/4679 is fixed.
          // expect(e.cpu, `${id}.cpu`).to.equal(2);
          // cpu: 2,
          concurrency: 42,
        });
      }
      if ("taskQueueTrigger" in e) {
        expect(e.taskQueueTrigger).to.deep.equal({
          retryConfig: {
            maxAttempts: 42,
            maxRetrySeconds: 42,
            maxBackoffSeconds: 42,
            maxDoublings: 42,
            minBackoffSeconds: 42,
          },
          rateLimits: {
            maxDispatchesPerSecond: 42,
            maxConcurrentDispatches: 42,
          },
        });
      }
    }
  });

  it.skip("restores default values if options are explicitly cleared out", async () => {
    const opts: Opts = {
      v1Opts: {
        memory: undefined,
        maxInstances: undefined,
        timeoutSeconds: undefined,
      },
      v2Opts: {
        memory: undefined,
        maxInstances: undefined,
        timeoutSeconds: undefined,
        cpu: undefined,
        concurrency: undefined,
      },
      v1TqOpts: {
        retryConfig: {
          maxAttempts: undefined,
          maxRetrySeconds: undefined,
          maxBackoffSeconds: undefined,
          maxDoublings: undefined,
          minBackoffSeconds: undefined,
        },
        rateLimits: {
          maxDispatchesPerSecond: undefined,
          maxConcurrentDispatches: undefined,
        },
      },
      v2TqOpts: {
        retryConfig: {
          maxAttempts: undefined,
          maxRetrySeconds: undefined,
          maxBackoffSeconds: undefined,
          maxDoublings: undefined,
          minBackoffSeconds: undefined,
        },
        rateLimits: {
          maxDispatchesPerSecond: undefined,
          maxConcurrentDispatches: undefined,
        },
      },
      v1IdpOpts: {
        blockingOptions: {},
      },
      v2IdpOpts: {},
    };
    await setOpts(opts);

    const result = await cli.exec(
      "deploy",
      FIREBASE_PROJECT,
      ["--only", "functions", "--non-interactive", "--force"],
      __dirname,
      false
    );
    expect(result.stdout, "deploy result").to.match(/Deploy complete!/);

    const endpoints = await listFns(RUN_ID);
    expect(Object.keys(endpoints).length, "number of deployed functions").to.equal(FNS_COUNT);

    for (const e of Object.values(endpoints)) {
      expect(e).to.include({
        availableMemoryMB: 128,
        // TODO: Fix bug where timeout is being updated, not inferred from existing.
        // timeoutSeconds: 42,
        maxInstances: 42,
      });
      if (e.platform === "gcfv2") {
        expect(e).to.include({
          // TODO: Re-enable once https://github.com/firebase/firebase-tools/issues/4679 is fixed.
          // expect(e.cpu, `${id}.cpu`).to.equal(2);
          // cpu: 2,
          concurrency: 42,
        });
      }
      if ("taskQueueTrigger" in e) {
        expect(e.taskQueueTrigger).to.deep.equal({
          retryConfig: {
            maxAttempts: 42,
            maxRetrySeconds: 42,
            maxBackoffSeconds: 42,
            maxDoublings: 42,
            minBackoffSeconds: 42,
          },
          rateLimits: {
            maxDispatchesPerSecond: 42,
            maxConcurrentDispatches: 42,
          },
        });
      }
    }
  });
});