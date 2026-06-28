// Replace families.map block (lines 282-324) in SpeciesTally.tsx with a call to <FamilyBlock>.
import fs from "node:fs";
const path = "client/src/components/SpeciesTally.tsx";
const src = fs.readFileSync(path, "utf8");
const lines = src.split("\n");

const startIdx = 281; // line 282 "{families.map((f) => {"
const endIdx = 323;   // line 324 "})}"  (inclusive) -> index 323
if (!lines[startIdx].includes("families.map")) {
  console.error("Anchor mismatch start:", lines[startIdx]);
  process.exit(1);
}
// trim of "                  })}" should equal "})}"
if (lines[endIdx].trim() !== "})}") {
  console.error("Anchor mismatch end:", lines[endIdx]);
  process.exit(1);
}

const replacement = `                  {families.map((f) => {
                    const famIdx = FAMILIES.findIndex((x) => x.id === f.id);
                    return (
                      <FamilyBlock
                        key={f.id}
                        family={f}
                        famUserCount={byFamily.get(f.id) || 0}
                        famTotal={familyTotalsQs[famIdx]?.data ?? null}
                        famLoading={isLoading || familyTotalsQs[famIdx]?.isLoading}
                        userGenera={Array.from(byGenus.entries())
                          .filter(([, v]) => v.familyId === f.id)
                          .map(([genus, v]) => ({ genus, count: v.count }))}
                        recordedIds={recordedIds}
                        expandedGenera={expandedGenera}
                        toggleGenus={toggleGenus}
                      />
                    );
                  })}`;

const newLines = [
  ...lines.slice(0, startIdx),
  ...replacement.split("\n"),
  ...lines.slice(endIdx + 1),
];
fs.writeFileSync(path, newLines.join("\n"));
console.log("Patched SpeciesTally.tsx — replaced families.map block.");
