// Occupational health questionnaire: HAVS, noise and skin, as the Control of Vibration at Work Regulations 2005 and
// the Control of Noise at Work Regulations 2005 health surveillance expects for installers. One definition is used by
// the operative page (to render it) and the server (to validate answers and raise the review flags).
const KINDS = { baseline: 'Pre-placement baseline (new starter)', annual: 'Annual periodic review', adhoc: 'Ad hoc review (symptoms reported or exposure change)' };

const SECTIONS = [
  {
    id: 'B', title: 'Hand-arm vibration (HAVS)', flag: 'havs', flag_label: 'HAVS: occupational health referral',
    intro: 'HAVS symptoms include fingers going white or changing colour, tingling or numbness in the fingers, loss of grip strength, and pain or aching in the hands or arms. Symptoms are often worse in cold or wet conditions.',
    questions: [
      { id: 'B1', text: 'Do you currently use hand-held vibrating tools as part of your work? (for example impact driver, SDS drill, mitre saw, multi-tool, angle grinder)', detail: 'List the main vibrating tools you use and roughly how long you use them each day' },
      { id: 'B2', text: 'Do any of your fingers ever go white (blanch) or change colour, for example turning white, then blue, then red?', flag: true, detail: 'Which fingers are affected, and in what circumstances?' },
      { id: 'B3', text: 'Has finger blanching or colour change ever occurred at work, or shortly after using vibrating tools?', flag: true },
      { id: 'B4', text: 'Does cold weather or cold water make any colour change in your fingers worse?', flag: true },
      { id: 'B5', text: 'Have you ever been told you have Raynaud\'s disease or Raynaud\'s phenomenon?', flag: true, detail: 'Was this diagnosed before or after starting work with vibrating tools?' },
      { id: 'B6', text: 'Do you experience tingling or pins and needles in your fingers or hands?', flag: true, detail: 'When does this occur: during tool use, after use, at night, or all the time?' },
      { id: 'B7', text: 'Do you experience numbness or loss of feeling in your fingers or hands?', flag: true, detail: 'Which fingers or areas are affected?' },
      { id: 'B8', text: 'Have you noticed a reduced ability to feel things with your fingertips, for example difficulty picking up small objects, doing up buttons, or feeling textures?', flag: true },
      { id: 'B9', text: 'Do any of the above symptoms wake you at night?', flag: true },
      { id: 'B10', text: 'Do you experience pain, aching or stiffness in your hands, wrists, elbows or shoulders that you think may be related to tool use?', flag: true, detail: 'Which areas, and when does it occur?' },
      { id: 'B11', text: 'Do you have reduced grip strength or find it difficult to perform tasks requiring hand strength?', flag: true },
      { id: 'B12', text: 'Have you been diagnosed with carpal tunnel syndrome or any other condition affecting the hands, wrists or arms?', flag: true, detail: 'Details, including date of diagnosis and any treatment' },
      { id: 'B13', text: 'Have you ever been formally diagnosed with HAVS?', flag: true, detail: 'Details, including date of diagnosis and Stockholm scale stage if known' },
      { id: 'B14', text: 'Do you have any condition affecting blood circulation, for example diabetes, Buerger\'s disease, or hardening of the arteries?', detail: 'Details' },
      { id: 'B15', text: 'Do you smoke, or have you smoked in the past? (Smoking affects circulation and can worsen HAVS symptoms.)', detail: 'How many a day, or when did you stop?' },
      { id: 'B16', text: 'Are you taking any regular medication? (Some medications affect circulation and nerve function.)', detail: 'Medication names' },
    ],
  },
  {
    id: 'C', title: 'Noise and hearing', flag: 'hearing', flag_label: 'Hearing: audiometry referral',
    intro: 'Signs of noise-induced hearing loss include difficulty following conversations, needing to turn the TV or radio up, ringing or buzzing in the ears (tinnitus), and muffled hearing after a noisy shift.',
    questions: [
      { id: 'C1', text: 'Do you work in places where you have to raise your voice to be heard by someone 2 metres away?' },
      { id: 'C2', text: 'Do you use hearing protection (ear plugs or ear defenders) at work?', detail: 'How often: always, most of the time, or sometimes?' },
      { id: 'C3', text: 'Do you regularly use any of the following: mitre saw, chop saw, SDS drill, angle grinder, or other high-noise power tools?', detail: 'The main noisy tools or environments' },
      { id: 'C4', text: 'Do you have difficulty hearing or following conversations in noisy environments, for example on a busy site?', flag: true },
      { id: 'C5', text: 'Do you have difficulty hearing clearly when there is background noise, for example with the TV on or in a busy room?', flag: true },
      { id: 'C6', text: 'Do family, friends or colleagues tell you that you have the TV or radio turned up too loud?', flag: true },
      { id: 'C7', text: 'Do you experience ringing, buzzing, hissing or other sounds in your ears (tinnitus)?', flag: true, detail: 'Constant or intermittent? One ear or both?' },
      { id: 'C8', text: 'Do you notice that your hearing seems muffled or reduced after a noisy shift, even temporarily?', flag: true },
      { id: 'C9', text: 'Have you ever had sudden hearing loss or a sudden increase in tinnitus after a loud noise?', flag: true, detail: 'Details' },
      { id: 'C10', text: 'Have you ever had a formal hearing test (audiogram), at work or privately?', detail: 'Roughly when, and what was the outcome?' },
      { id: 'C11', text: 'Have you ever been told you have noise-induced hearing loss, or any other form of hearing loss?', flag: true, detail: 'Details' },
      { id: 'C12', text: 'Have you had any ear operations, serious ear infections, or injuries to your ears?', flag: true, detail: 'Details' },
      { id: 'C13', text: 'Are you exposed to loud noise outside work, for example music, shooting, motorsport or power tools?', detail: 'Describe' },
    ],
  },
  {
    id: 'D', title: 'Skin health', flag: 'skin', flag_label: 'Skin: dermatitis review',
    intro: 'Sealants, foams, solvents and frequent hand washing can all affect the skin. Occupational dermatitis is easier to deal with the earlier it is picked up.',
    questions: [
      { id: 'D1', text: 'Do you get redness, itching, swelling or soreness on your hands or forearms that you think may be related to substances you handle at work?', flag: true, detail: 'Which substances or tasks do you associate with it?' },
      { id: 'D2', text: 'Do you get cracking, blistering or flaking of the skin on your hands or forearms?', flag: true },
      { id: 'D3', text: 'Do any skin symptoms improve when you are away from work, for example over a weekend or on holiday?', flag: true },
      { id: 'D4', text: 'Have any skin symptoms lasted for more than a week?', flag: true },
      { id: 'D5', text: 'Have you ever been diagnosed with occupational dermatitis or a skin sensitisation?', flag: true, detail: 'Details, including the substance if known' },
    ],
  },
];

const DECLARATION = 'I confirm that the information I have given in this questionnaire is accurate and complete to the best of my knowledge. I understand that its purpose is to protect my health, that my answers are kept confidential by the company and its health and safety adviser, and that if I develop any new symptoms I should report them to my supervisor without waiting for the next review.';

const ALL = SECTIONS.flatMap(s => s.questions.map(x => ({ ...x, section: s.id })));

// Checks a submitted answer set and works out which review flags it raises. Returns { ok, error, answers, flags }.
function evaluate(body) {
  const a = (body && body.answers) || {};
  const out = {};
  for (const x of ALL) {
    const v = a[x.id] || {};
    if (v.a !== 'yes' && v.a !== 'no') return { ok: false, error: `Answer question ${x.id} before signing.` };
    out[x.id] = { a: v.a, d: v.a === 'yes' && x.detail ? String(v.d || '').trim().slice(0, 600) : '' };
  }
  const flags = SECTIONS.filter(s => s.questions.some(x => x.flag && out[x.id].a === 'yes')).map(s => s.flag);
  return { ok: true, answers: out, flags };
}

const publicDefinition = () => ({ kinds: KINDS, sections: SECTIONS, declaration: DECLARATION });
const flagLabel = f => (SECTIONS.find(s => s.flag === f) || {}).flag_label || f;

module.exports = { KINDS, SECTIONS, DECLARATION, evaluate, publicDefinition, flagLabel };
