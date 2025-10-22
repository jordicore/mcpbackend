// importPowerBIStructure.js
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const INPUT_FILE = "parsed-powerbi.json";

async function importToSupabase() {
  console.log(`📥 Reading ${INPUT_FILE}...`);
  const data = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"));

  const rows = [];
  for (const [datasetId, visuals] of Object.entries(data)) {
    for (const [visualId, entities] of Object.entries(visuals)) {
      for (const [entityName, details] of Object.entries(entities)) {
        rows.push({
          dataset_id: datasetId,
          visual_id: visualId,
          entity_name: entityName,
          columns: details.columns || [],
          measures: details.measures || [],
        });
      }
    }
  }

  console.log(`🧾 Preparing to insert ${rows.length} rows...`);
  const { data: inserted, error } = await supabase
    .from("powerbi_semantic_model")
    .upsert(rows, { onConflict: ["dataset_id", "visual_id", "entity_name"] });

  if (error) {
    console.error("❌ Insert error:", error);
  } else {
    console.log(`✅ Successfully imported ${inserted.length} rows into powerbi_semantic_model`);
  }
}

importToSupabase();
