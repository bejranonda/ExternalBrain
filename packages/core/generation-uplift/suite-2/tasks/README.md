# These files are evidence, not source. Do not "fix" them.

Every file under `tasks/*/{control,treatment,treatment-uncurated}/` is the **raw,
unmodified output of a benchmark agent run**. They are committed so a reader can
audit what was actually generated and re-grade it independently.

**Editing them falsifies the experiment.** A reviewer — human or automated — will
often be correct that a given file has a bug: the control arms in particular are
*supposed* to contain the mistakes the benchmark measures. Task 1's control file
is missing `force-dynamic`; that is the finding, not a defect to repair.

If you spot a genuine problem in one of these files, the right response is to
record it in `../RESULTS.md` as an observation about the run, and — if it bears on
the pre-registered assertion — to say so explicitly and re-report the grade both
ways. Never silently change the artifact to match what the code *should* have been.

They are also deliberately outside `src/`, so neither the package `tsconfig`
(`include: ["src/**/*"]`) nor vitest (`include: ["src/**/__tests__/**/*.test.ts"]`)
picks them up. They are not typechecked and not run in CI, by design — several
import `next/server`, React, or workspace subpaths that `@brain/core` does not
depend on.
