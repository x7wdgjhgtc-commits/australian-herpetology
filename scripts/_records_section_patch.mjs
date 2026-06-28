// One-off patch: replace lines 797-915 (Photos from the field section) in Species.tsx
import fs from "node:fs";
const path = "client/src/pages/Species.tsx";
const src = fs.readFileSync(path, "utf8");
const lines = src.split("\n");

// Sanity check: line 797 (index 796) should be the comment.
const startIdx = 796; // line 797
const endIdx = 914; // line 915 (blank line after </Section>)
if (!lines[startIdx].includes("Photos with credits + location")) {
  console.error("Anchor mismatch at line 797:", lines[startIdx]);
  process.exit(1);
}
if (!lines[endIdx - 1].trim().endsWith("</Section>")) {
  console.error("Anchor mismatch at line 915 area:", lines[endIdx - 1]);
  process.exit(1);
}

const replacement = `      {/* Unified Records list: iNaturalist observations + Hunt Herpetology app records */}
      <Section title="Records">
        <RecordsList
          loading={loadingObs || loadingSpeciesRecords}
          inatObservations={obsData?.results || []}
          appRecords={speciesRecords}
          displayCommonName={displayCommonName}
          isAdminPlus={isAdminPlus}
          isHidden={isHidden}
          hidePhoto={hidePhoto}
          unhidePhoto={unhidePhoto}
        />
      </Section>
`;

const newLines = [
  ...lines.slice(0, startIdx),
  ...replacement.split("\n").slice(0, -1), // drop final empty from split
  ...lines.slice(endIdx),
];
fs.writeFileSync(path, newLines.join("\n"));
console.log("Patched Species.tsx — replaced lines 797-915 with new <RecordsList /> block.");
