'use client';
import {useState} from 'react';
import {Calendar, Check, Cross, Spark} from '@/components/site/icons';
import {QUESTION,LETTERS} from './sample-data';

// The question body, shared by the home page sample panel and the sample card on exam, sitting and FAQ pages.
export type SampleData={where:string;stem:string;options:string[];answer:number;why:string;others:string[];notes:string[];seen?:string|null;highYield?:boolean};
// Without data it shows the website's own marketing sample; with data, a staff-chosen free sample from the bank (SEO-2).
export function SampleQuestionBody({data}:{data?:SampleData}={}) {
  const Q=data??{...QUESTION,where:'MRCOG Part 1 · sample question',seen:'Seen in two sittings',highYield:true};
  const [chosen, setChosen] = useState<number | null>(null);
  const done = chosen !== null, correct = chosen === Q.answer;
  return <div className="hq">
    <div className="sheet-head"><span className="where">{Q.where}</span>
      {Q.seen&&<span className="ticket"><Calendar />{Q.seen}</span>}{Q.highYield&&<span className="ticket hy"><Spark />High-yield</span>}</div>
    <p className="stem">{Q.stem}</p>
    <ol>{Q.options.map((o, i) => {
      const right = done && i === Q.answer, wrong = done && i === chosen && !correct;
      return <li key={o}><button type="button" className={`opt${right ? ' right' : ''}${wrong ? ' wrong' : ''}`} disabled={done} aria-pressed={chosen === i} onClick={() => setChosen(i)}>
        <span className="letter">{LETTERS[i]}</span>{o}{right && <span className="mark" style={{ color: 'var(--ok)' }}><Check /> Answer</span>}{wrong && <span className="mark" style={{ color: 'var(--no)' }}><Cross /> Your choice</span>}</button></li>;
    })}</ol>
    {done ? <div className="feedback" aria-live="polite">
      <p className={`verdict ${correct ? 'ok' : 'no'}`}>{correct ? 'Correct.' : `Not quite. The answer is ${LETTERS[Q.answer]}${data?'':', oxytocin'}.`}</p>
      <p>{Q.why}</p>
      {Q.others.some(Boolean)&&<><h4>Why not the others</h4><ul>{Q.others.map((t, i) => t && <li key={i}><strong>{LETTERS[i]}.</strong> {t}</li>)}</ul></>}
      {Q.notes.length>0&&<><h4>Key notes</h4><ul>{Q.notes.map(n => <li key={n}>{n}</li>)}</ul></>}
      <button type="button" className="again" onClick={() => setChosen(null)}>Try it again</button>
    </div> : <p className="hint">Choose an answer to see the explanation, exactly as it appears in practice.</p>}
  </div>;
}

export function SampleQuestion() {
 return <div className="q-card" aria-label="Sample question"><SampleQuestionBody /></div>;
}
