import type { Database } from './client';
export async function seedCatalogue(db: Database) {
  await db.transaction(async tx => {
    for (const [slug, name] of [['mrcog','MRCOG'],['amc','AMC']]) {
      await tx.query('INSERT INTO exam_families(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING',[slug,name]);
    }
    const entries = [
      ['mrcog','mrcog-part-1','MRCOG Part 1','Build your foundation in the basic and clinical sciences of obstetrics and gynaecology.'],
      ['mrcog','mrcog-part-2','MRCOG Part 2','Bring clinical knowledge together for the next stage of your obstetrics and gynaecology training.'],
      ['amc','amc-part-1','AMC Part 1','Prepare for the next step in your Australian medical licensing journey.'],
    ];
    for (const [family,slug,name,description] of entries) {
      await tx.query('INSERT INTO exams(family_id,slug,name,description) SELECT id,$2,$3,$4 FROM exam_families WHERE slug=$1 ON CONFLICT(slug) DO NOTHING',[family,slug,name,description]);
    }
    // Public URL slug within the family, e.g. mrcog-part-1 -> /mrcog/part-1-recalls.
    await tx.query(`UPDATE exams e SET seo_slug=regexp_replace(e.slug,'^'||f.slug||'-','')||'-recalls' FROM exam_families f WHERE f.id=e.family_id AND e.seo_slug IS NULL`);
  });
}
