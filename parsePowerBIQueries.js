// parsePowerBIQueries.js
import fs from "fs";

const INPUT_FILE = "powerbi-queries.json";
const OUTPUT_FILE = "parsed-powerbi.json";

function parsePowerBIQueries() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ File not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  console.log(`📖 Reading ${INPUT_FILE}...`);
  const raw = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));

  const summary = {};

  for (const item of raw) {
    if (!item.body) continue;

    let bodyJson;
    try {
      bodyJson = JSON.parse(item.body);
    } catch (err) {
      console.warn("⚠️ Skipping malformed body:", err.message);
      continue;
    }

    const query = bodyJson?.queries?.[0];
    const ctx = query?.ApplicationContext || {};
    const datasetId = ctx.DatasetId || "unknown_dataset";
    const reportId = ctx.Sources?.[0]?.ReportId || "unknown_report";
    const visualId = ctx.Sources?.[0]?.VisualId || "unknown_visual";

    const commands = query?.Query?.Commands || [];
    for (const cmd of commands) {
      const semantic = cmd.SemanticQueryDataShapeCommand;
      if (!semantic) continue;

      const selects = semantic.Query?.Select || [];
      const froms = semantic.Query?.From || [];
      const entities = froms.map(f => f.Entity);

      for (const entity of entities) {
        if (!summary[datasetId]) summary[datasetId] = {};
        if (!summary[datasetId][visualId]) summary[datasetId][visualId] = {};
        if (!summary[datasetId][visualId][entity])
          summary[datasetId][visualId][entity] = { columns: [], measures: [] };

        for (const s of selects) {
          if (s.Column?.Property) {
            summary[datasetId][visualId][entity].columns.push(s.Column.Property);
          }
          if (s.Measure?.Property) {
            summary[datasetId][visualId][entity].measures.push(s.Measure.Property);
          }
        }
      }
    }
  }

  // Deduplicate columns & measures
  for (const ds of Object.values(summary)) {
    for (const vis of Object.values(ds)) {
      for (const ent of Object.values(vis)) {
        ent.columns = [...new Set(ent.columns)];
        ent.measures = [...new Set(ent.measures)];
      }
    }
  }

  console.log("✅ Parsed Power BI structure:");
  for (const [dataset, visuals] of Object.entries(summary)) {
    console.log(`\n📊 Dataset: ${dataset}`);
    for (const [visual, entities] of Object.entries(visuals)) {
      console.log(`  🎨 Visual: ${visual}`);
      for (const [entity, fields] of Object.entries(entities)) {
        console.log(`    🧱 Entity: ${entity}`);
        if (fields.columns.length)
          console.log(`      📋 Columns: ${fields.columns.join(", ")}`);
        if (fields.measures.length)
          console.log(`      📈 Measures: ${fields.measures.join(", ")}`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));
  console.log(`\n💾 Saved structured summary to ${OUTPUT_FILE}`);
}

parsePowerBIQueries();
