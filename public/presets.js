// Example setups for the "Examples…" menu. The first one is shown on a fresh visit.
// Shape: { text, questions: [{ type: "choice" | "noul" | "score", instructions, options?: [{ label, desc? }] }] }
export const PRESETS = {
  "What is best in life?": {
    text: "Q: What is best in life?\nA: To crush your enemies, see them driven before you, and to hear the lamentations of their women.",
    questions: [
      { type: "noul", instructions: "Is the answer true?" },
      { type: "choice", instructions: "Who most likely gave this answer?", options: [
        { label: "a kindergarten teacher" },
        { label: "Conan the Barbarian" },
        { label: "Arnold Schwarzenegger" },
        { label: "a Buddhist monk" },
        { label: "a customer support agent" }] },
      { type: "choice", instructions: "What is actually best in life?", options: [
        { label: "crushing your enemies" },
        { label: "friendship" },
        { label: "a good night's sleep" },
        { label: "well-calibrated probabilities" }] },
      { type: "score", instructions: "How violent is the answer?", options: [
        { label: "peaceful" }, { label: "a bit aggressive" }, { label: "violent" }, { label: "barbaric" }] },
    ],
  },
  "This sentence is not true": {
    text: "This sentence is not true.",
    questions: [
      { type: "noul", instructions: "Is the sentence true?" },
      { type: "noul", instructions: "Is the sentence false?" },
      { type: "choice", instructions: "What kind of statement is this?", options: [
        { label: "true", desc: "it correctly describes itself" },
        { label: "false", desc: "it incorrectly describes itself" },
        { label: "paradox", desc: "true if and only if it is false" },
        { label: "meaningless", desc: "it makes no claim at all" }] },
    ],
  },
  "The catalog of catalogs": {
    text: "A librarian compiles a catalog that lists every catalog that does not list itself, and no other catalogs.",
    questions: [
      { type: "noul", instructions: "Does the catalog list itself?" },
      { type: "choice", instructions: "Should the librarian include the catalog in itself?", options: [
        { label: "yes", desc: "it is a catalog that does not list itself, so it belongs" },
        { label: "no", desc: "once listed, it lists itself, so it must not be listed" },
        { label: "impossible", desc: "both answers contradict the rule; the catalog cannot exist" }] },
      { type: "choice", instructions: "Which famous problem is this?", options: [
        { label: "Russell's paradox" },
        { label: "the liar paradox" },
        { label: "Zeno's paradox" },
        { label: "the Monty Hall problem" }] },
    ],
  },
  // Swap in another character to watch the gauge move: Sauron ≈ 2.7, the Grinch ≈ 1.9, Gru ≈ 0.8,
  // Paddington ≈ 0. Keep the level labels short: descriptive ones made this checkpoint worse.
  "The villain meter": {
    text: "Darth Vader force-chokes officers who disappoint him and helps destroy a planet, but in the end he turns on the Emperor to save his son.",
    questions: [
      { type: "score", instructions: "How evil is this character?", options: [
        { label: "good" }, { label: "morally grey" }, { label: "evil" }, { label: "pure evil" }] },
      { type: "noul", instructions: "Does the character redeem themselves?" },
    ],
  },
  "The Ship of Theseus": {
    text: "Over the years every plank of Theseus' ship is replaced, one at a time. Someone collects the old planks and builds a second ship from them.",
    questions: [
      { type: "choice", instructions: "Which one is the real Ship of Theseus?", options: [
        { label: "the repaired ship", desc: "the one that sailed on all along" },
        { label: "the rebuilt ship", desc: "the one made of the original planks" },
        { label: "both" },
        { label: "neither" }] },
      { type: "score", instructions: "How much of the original ship is left in the repaired one?", options: [
        { label: "none of it" }, { label: "some of it" }, { label: "all of it" }] },
      { type: "noul", instructions: "Is this a question with a single correct answer?" },
    ],
  },
};
