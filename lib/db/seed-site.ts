import type {Database} from './client';
// Starting drafts for the company and policy pages, taken from decisions recorded in the PRD.
// They are clearly marked for legal review and are edited in Studio → Website; existing text is never overwritten.
const DRAFT='This page is a draft awaiting legal review. It will be finalised before paid access opens.';
const PAGES:[string,string,string][]=[
 ['about','About Recalls Tutor',`Recalls Tutor is a question bank for postgraduate medical licensing exams. After each sitting, students discuss and share the questions they remember in study groups and online communities. We collect those student-shared recalls, compile and organise them into complete practice questions, and add new ones after every exam diet.

## How questions are made
Recalls are collected from student groups and communities and stripped of personal details. They do not come from exam halls or from any exam body. An AI assistant drafts each recall into an exam-style question with an explanation and references. A qualified reviewer then checks the answer, the explanation and the references. Nothing reaches students without that human approval.

## Independence
Recalls Tutor is independent. It is not affiliated with, endorsed by or connected to any exam body. Exam names are used only to describe the exams our questions help you prepare for.`],
 ['contact','Contact',`Contact details for support and partnerships will be published here before access opens.

If you are a course provider interested in giving your students access, partner enquiries will be listed here too.`],
 ['terms','Terms of use',`${DRAFT}

## Your account
- Your subscription is personal. Sharing your account or login with anyone else is not allowed.
- You must not copy, record, screenshot, resell or redistribute questions, explanations or any other content.
- Questions carry a watermark linked to your account so that leaked content can be traced. Accounts that share or redistribute content may be suspended.

## Plans
- Plans are per exam and include every published sitting of that exam, including sittings added during your plan.
- Plans renew automatically until you turn auto-renew off. You keep access until the end of the period you have paid for.

## Content
Questions are compiled from recalls that students share after their exams and are reviewed by qualified reviewers. They are for practice and are not official exam questions. No result in practice or in any prediction guarantees an exam outcome.`],
 ['privacy','Privacy policy',`${DRAFT}

## What we collect
Your name, email address, country, the exams you are preparing for, an optional exam date and timezone, and your practice activity.

## How we use it
To give you access, track your progress, keep your account secure and, only if you agree, send you marketing about our exams.

## Uploaded recalls
Names, phone numbers, email addresses and other identifiers are removed from recall sources before they are stored or processed. Source material is never shown publicly.

## Your rights
You can ask for a copy of your data or for your account to be deleted. We follow the UK and EU GDPR and the Australian Privacy Act.

## Cookies
Analytics cookies are only set if you accept them in the cookie banner.`],
 ['refund-policy','Refund policy',`${DRAFT}

The proposed policy is a full refund if you ask within 48 hours of purchase and have attempted fewer than 50 questions. This will be confirmed before checkout opens and shown at checkout.

You can turn off auto-renew at any time from your account. You keep access until the end of the period you have paid for.`],
];
const FAQS:[string,string][]=[
 ['What is a recall?','A recall is a question a student remembers after sitting an exam and shares with others, usually in study groups and online communities. We collect these student-shared recalls from many sources, then compile, organise and structure them into practice questions.'],
 ['Who checks the questions?','Every question is reviewed by a qualified reviewer before it is published. The AI only drafts questions; it can never publish them.'],
 ['What does “Seen in” mean?','Each question shows the sittings it was recalled from. Questions recalled in two or more sittings are marked high-yield.'],
 ['Does my plan include new sittings?','Yes. A plan covers one exam and includes every published sitting of that exam, including sittings added while your plan is active.'],
 ['Do plans renew automatically?','Yes. All plans renew automatically until you turn auto-renew off, which you can do at any time. You keep access until the end of the period you have paid for.'],
 ['Is there a free trial?','Where a free trial is offered for an exam, you can try it without a card. There is one trial per exam per account.'],
 ['Are these official exam questions?','No. They are compiled from questions students shared after their exams and written in our own words. They do not come from exam halls or from any exam body. Recalls Tutor is not affiliated with or endorsed by any exam body.'],
];
// Wording that earlier seeds wrote and that the recall-source correction replaced. Rows still holding the old
// default sentence are brought up to date; anything an editor has changed is left alone.
const SUPERSEDED:[string,string][]=[["Recalls Tutor is a question bank for postgraduate medical licensing exams, built from what candidates remember after each sitting and refreshed after every exam diet.","Recalls Tutor is a question bank for postgraduate medical licensing exams. After each sitting, students discuss and share the questions they remember in study groups and online communities. We collect those student-shared recalls, compile and organise them into complete practice questions, and add new ones after every exam diet."],["Candidates' recalls are collected and stripped of personal details.","Recalls are collected from student groups and communities and stripped of personal details. They do not come from exam halls or from any exam body."],["Questions are reconstructed from candidates' recollections and reviewed by qualified reviewers.","Questions are compiled from recalls that students share after their exams and are reviewed by qualified reviewers."],["A recall is a candidate’s memory of a question they saw in a real exam sitting. We collect recalls after each sitting and turn them into practice questions.","A recall is a question a student remembers after sitting an exam and shares with others, usually in study groups and online communities. We collect these student-shared recalls from many sources, then compile, organise and structure them into practice questions."],["No. Questions are reconstructed from candidates’ recollections and written in our own words.","No. They are compiled from questions students shared after their exams and written in our own words. They do not come from exam halls or from any exam body."]];
export async function seedSiteContent(db:Database) {
 await db.transaction(async tx=>{
  for(const [slug,title,body] of PAGES)await tx.query('INSERT INTO site_pages(slug,title,body) VALUES($1,$2,$3) ON CONFLICT(slug) DO NOTHING',[slug,title,body]);
  if(!(await tx.query('SELECT 1 FROM faqs WHERE exam_id IS NULL LIMIT 1')).length)for(const [i,[question,answer]] of FAQS.entries())await tx.query('INSERT INTO faqs(question,answer,sort) VALUES($1,$2,$3)',[question,answer,i]);
  for(const [old,now] of SUPERSEDED){
   await tx.query('UPDATE site_pages SET body=replace(body,$1,$2) WHERE strpos(body,$1)>0',[old,now]);
   await tx.query('UPDATE faqs SET answer=replace(answer,$1,$2) WHERE strpos(answer,$1)>0',[old,now]);
  }
 });
}
