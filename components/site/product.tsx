import { SampleQuestionBody } from '@/components/public/sample-question';
import { QUESTION, LETTERS } from '@/components/public/sample-data';
import { Check, Clock, Target } from '@/components/site/icons';

// The hero's product shot: the real practice screen drawn in HTML, with the sample question live inside it.
// Side panels are illustrative and say so; nothing here is a real student's data.
const NAV = ['Practice', 'Sessions and results', 'My plans', 'Account security'];
const CELLS = ['done', 'done', 'flag', 'now', '', 'done', '', 'flag', '', '', '', '', '', '', ''];

export function ProductShot() {
  return <figure className="shot">
    <div className="shot-frame">
      <div className="shot-bar" aria-hidden="true"><i /><i /><i /><span>Recalls Tutor · MRCOG Part 1 · Revision Mode</span></div>
      <div className="shot-body">
        <aside className="shot-side" aria-hidden="true"><b>Study</b>{NAV.map((n, i) => <span key={n} className={i === 0 ? 'on' : undefined}>{n}</span>)}</aside>
        <div className="shot-main"><SampleQuestionBody /></div>
        <aside className="shot-rail" aria-hidden="true"><b>Navigator</b><div className="navgrid">{CELLS.map((c, i) => <span key={i} className={c}>{i + 1}</span>)}</div><p>4 answered · 2 flagged</p></aside>
      </div>
    </div>
    <div className="float float-a" aria-hidden="true"><Target size={16} /><span><b>Obstetrics</b> 72% correct</span><em>Example</em></div>
    <div className="float float-b" aria-hidden="true"><Check size={16} /><span><b>Mistakes deck</b> back until right twice</span></div>
    <figcaption>The practice screen, with a sample question you can answer.</figcaption>
  </figure>;
}

// Small fragments of the app for the feature rows. Figures are labelled as examples.
export function FeedbackFragment() {
  return <div className="frag" aria-hidden="true">
    <div className="frag-opt right"><span className="letter">{LETTERS[QUESTION.answer]}</span>{QUESTION.options[QUESTION.answer]}<em><Check size={14} /> Answer</em></div>
    <div className="frag-opt wrong"><span className="letter">B</span>{QUESTION.options[1]}<em>Your choice</em></div>
    <p className="frag-verdict">Not quite. The answer is {LETTERS[QUESTION.answer]}.</p>
    <p className="frag-text">{QUESTION.why}</p>
    <p className="frag-h">Key notes</p>
    <ul>{QUESTION.notes.slice(0, 2).map(n => <li key={n}>{n}</li>)}</ul>
  </div>;
}

export function ExamFragment() {
  return <div className="frag" aria-hidden="true">
    <div className="frag-row"><span className="frag-h">Question 4 of 20</span><span className="timer"><Clock size={18} /> 41:20</span></div>
    <div className="navgrid wide">{[...CELLS, '', '', '', '', ''].map((c, i) => <span key={i} className={c}>{i + 1}</span>)}</div>
    <ul className="legend"><li><i className="done" />Answered</li><li><i className="flag" />Flagged</li><li><i className="now" />Current</li></ul>
    <p className="frag-text">Results arrive at the end, by topic, with every explanation.</p>
  </div>;
}

export function ProgressFragment() {
  const rows = [['Obstetrics', 72, 'tab-blue'], ['Gynaecology', 58, 'tab-teal'], ['Anatomy', 81, 'tab-sky'], ['Physiology', 44, 'tab-amber'], ['Statistics', 63, 'tab-violet']] as const;
  return <div className="frag" aria-hidden="true">
    <p className="frag-h">Correct by topic</p>
    <ul className="meters">{rows.map(([t, n, tone]) => <li key={t} className={tone}><span>{t}</span><span className="track"><span className="fill" style={{ width: `${n}%` }} /></span><span className="n">{n}%</span></li>)}</ul>
    <p className="example"><Target size={14} /> Example figures, for illustration</p>
  </div>;
}
