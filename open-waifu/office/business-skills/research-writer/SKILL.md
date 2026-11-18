---
name: research-writer
description: "Provides high-quality research writing support: from background research and adding citations to improving the opening and refining the outline, with real-time section-by-section feedback and polishing suggestions. Use when the user asks for writing help such as \"help me research this\", \"improve my opening\" or \"organize an outline\", or needs section-by-section review, added citations or a polish of an article."
license: Apache-2.0
---
<!-- Changes: added license field to frontmatter, replaced ~/writing/ example paths with relative paths. Original source: https://github.com/ComposioHQ/awesome-claude-skills/tree/master/content-research-writer (Apache-2.0) -->

# Research Content Writing Assistant

This skill acts as your writing partner, helping you with background research, outlining, drafting and polishing while preserving your own writing style and voice.

## When to use it

- Writing blog posts, columns or newsletters
- Creating educational content or tutorials
- Drafting in-depth opinion pieces
- Researching and writing case studies
- Writing technical documents that need cited sources
- Standardizing citations and reference formats
- Improving article openings and introductions
- Getting section-by-section feedback while you write

## What it does

1. **Collaborative outlining**: turns your ideas into a well-organized outline
2. **Research assistance**: searches for relevant information and adds citations
3. **Opening improvement**: strengthens the opening to capture readers' attention
4. **Section-by-section feedback**: reviews each section as you write
5. **Style preservation**: keeps your writing style and voice
6. **Citation management**: adds and formats references consistently
7. **Iterative polishing**: improves the piece through multiple rounds of revision

## How to use it

### Set up the writing environment

Create a dedicated folder for your article and work inside it. For example:
```
mkdir my-article-title
cd my-article-title
```

Create a draft file:
```
touch article-draft.md
```

Open Claude Code from this directory to start writing.

### Basic workflow

1. **Start with an outline**:
```
Help me create an outline for an article about [topic]
```

2. **Research and add citations**:
```
Research [specific topic] and add citations to my outline
```

3. **Improve the opening**:
```
Here is my introduction. Please help me make the opening more compelling.
```

4. **Get section-by-section feedback**:
```
I just finished the "Why this matters" section. Please review it and give feedback.
```

5. **Polish**:
```
Review the full draft and check flow, clarity and consistency.
```

## Guidelines

When the user asks for writing help:

1. **Understand the writing project**

   Ask the following questions to clarify the need:
   - What is the topic and the core argument?
   - Who is the target reader?
   - What length and format do you want?
   - What is the purpose of the piece? (educate, persuade, share, explain)
   - Do you already have sources or material?
   - What writing style do you prefer? (formal, conversational, technical)

2. **Outline collaboratively**

   Help organize the structure of the content:

   ```markdown
   # Article outline: [Title]

   ## Hook
   - [Opening story / opening line / statistic]
   - [Why readers should care]

   ## Introduction
   - Background and context
   - Problem statement
   - What this article covers

   ## Main sections

   ### Section 1: [Title]
   - Point A
   - Point B
   - Example / evidence
   - [To research: specific topic]

   ### Section 2: [Title]
   - Point C
   - Point D
   - Data / citations to be added

   ### Section 3: [Title]
   - Point E
   - Counterargument
   - Response and summary

   ## Conclusion
   - Recap of key points
   - Call to action
   - Closing thought

   ## Research to-do
   - [ ] Find data on [topic]
   - [ ] Collect examples of [concept]
   - [ ] Find a citation source for [claim]
   ```

   **Refine the outline repeatedly**:
   - Adjust based on feedback
   - Make sure the logic holds together
   - Identify gaps in the material
   - Flag the parts that need deeper development

3. **Do the research**

   When the user asks for research on a topic:

   - Search for relevant information
   - Look for reliable sources
   - Extract key facts, quotes and data
   - Add citations in the requested format

   Example output:
   ```markdown
   ## Research: the impact of AI on productivity

   Key findings:

   1. **Productivity gains**: studies show time savings of 40% on content creation tasks [1]

   2. **Adoption**: 67% of knowledge workers use AI tools every week [2]

   3. **Expert view**: "AI augments human creativity rather than replacing it"
      - Dr. Jane Smith, MIT [3]

   References:
   [1] McKinsey Global Institute. (2024). "The Economic Potential
       of Generative AI"
   [2] Stack Overflow Developer Survey (2024)
   [3] Smith, J. (2024). MIT Technology Review interview

   Added to Section 2 of the outline.
   ```

4. **Improve the opening**

   When the user shares an introduction, analyze and strengthen it:

   **Analysis of the current opening**:
   - Strengths: [positive elements]
   - Could be better: [directions for improvement]
   - Emotional impact: [where it is now vs. its potential]

   **Improvement options**:

   Option 1: [A bold statement]
   > [Example]
   *Why it works: [explanation]*

   Option 2: [A personal story]
   > [Example]
   *Why it works: [explanation]*

   Option 3: [A surprising statistic]
   > [Example]
   *Why it works: [explanation]*

   **Self-check questions**:
   - Does it spark curiosity?
   - Does it convey a promise of value?
   - Is it specific enough?
   - Does it match the target reader?

5. **Give section-by-section feedback**

   After the user finishes each section, review it along these lines:

   ```markdown
   # Feedback: [Section name]

   ## What works well ✓
   - [Strength 1]
   - [Strength 2]
   - [Strength 3]

   ## Suggestions for improvement

   ### Clarity
   - [Specific issue] -> [Suggested change]
   - [Complex sentence] -> [Simpler wording]

   ### Coherence
   - [Transition problem] -> [Better connection]
   - [Paragraph order] -> [Suggested reordering]

   ### Evidence
   - [Claim that needs support] -> [Add a citation or example]
   - [Vague statement] -> [More specific wording]

   ### Style
   - [Inconsistent tone] -> [Wording closer to your style]
   - [Word choice] -> [Stronger alternative]

   ## Specific edit suggestions

   Original:
   > [Draft text]

   Suggested:
   > [Improved version]

   Reason: [Explanation]

   ## Questions to think about
   - [Thought-provoking question 1]
   - [Thought-provoking question 2]

   Ready to move on to the next section!
   ```

6. **Preserve the author's style**

   Key principles:

   - **Learn their style**: read their existing writing samples
   - **Suggest, don't replace**: offer options rather than imposing directions
   - **Match the tone**: formal, casual, technical, friendly
   - **Respect their choices**: if they prefer their own version, support it
   - **Improve, don't change**: make the piece better, not a different style

   Ask regularly:
   - "Does this sound like you?"
   - "Is this tone right?"
   - "Should it be more formal / more conversational / more technical?"

7. **Manage citations**

   Handle references according to the user's preference:

   **Inline citations**:
   ```markdown
   Research shows productivity increased by 40% (McKinsey, 2024).
   ```

   **Numbered citations**:
   ```markdown
   Research shows productivity increased by 40% [1].

   [1] McKinsey Global Institute. (2024)...
   ```

   **Footnote-style citations**:
   ```markdown
   Research shows productivity increased by 40%^1

   ^1: McKinsey Global Institute. (2024)...
   ```

   Maintain a running reference list:
   ```markdown
   ## References

   1. Author. (Year). "Title". Publication.
   2. Author. (Year). "Title". Publication.
   ...
   ```

8. **Final review and polish**

   Once the draft is complete, give comprehensive feedback:

   ```markdown
   # Full review

   ## Overall assessment

   **Strengths**:
   - [Main strength 1]
   - [Main strength 2]
   - [Main strength 3]

   **Overall effect**: [General assessment]

   ## Structure and coherence
   - [Assessment of organization]
   - [Quality of transitions]
   - [Assessment of pacing]

   ## Content quality
   - [Strength of argument]
   - [Sufficiency of evidence]
   - [Effectiveness of examples]

   ## Technical quality
   - Grammar and prose: [Assessment]
   - Consistency: [Assessment]
   - Citation completeness: [Check result]

   ## Readability
   - Clarity: [Assessment]
   - Sentence variety: [Assessment]
   - Paragraph length: [Assessment]

   ## Final polish suggestions

   1. **Introduction**: [Specific improvement]
   2. **Body**: [Specific improvement]
   3. **Conclusion**: [Specific improvement]
   4. **Title**: [Alternative title suggestions]

   ## Pre-publication checklist
   - [ ] All claims have sources
   - [ ] Citation format is consistent
   - [ ] Examples are clear
   - [ ] Transitions flow naturally
   - [ ] A call to action is included
   - [ ] Typos have been proofread

   Ready to publish! 🚀
   ```

## Examples

### Example 1: Teresa Torres's workflow

**User**: "I'm writing an article about continuous discovery. Help me create an outline."

**Process**:
1. Build the outline structure together
2. Identify research needs
3. The user starts writing the introduction
4. Review and improve the opening
5. The user writes section by section
6. Give feedback after each section
7. Do research and add citations
8. Final review of the full piece
9. Polish and prepare for publication

**Result**: a well-researched, properly cited article that keeps Teresa's writing style, with a clear structure and smooth prose.

### Example 2: A research-heavy article

**User**: "I'm writing about how AI affects product management. Help me find the latest data and cases."

**Output**:
```markdown
## Research summary

### Latest data
- Gartner: by 2025, 80% of product managers will use AI tools [1]
- Survey: 45% report faster feature delivery [2]
- Case: Airbnb's AI-assisted prioritization [3]

### Expert views
- "AI amplifies a product manager's judgment rather than replacing it" - Marty Cagan
- [More expert quotes and sources]

### Real-world cases
1. **Company A**: uses AI to synthesize user research
   - Result: 60% time saved
   - Source: [Citation]

2. **Company B**: AI-driven roadmap analysis
   - Result: better stakeholder alignment
   - Source: [Citation]

Everything has been added to the outline with citations.
```

### Example 3: Improving an opening

**User's original**:
> "Product management is changing because of AI. In this article, I will discuss some of the ways AI affects product managers."

**Improvement options**:

**Option 1 (data-driven)**:
> "Last month, I had AI analyze 500 customer interview transcripts. It took 30 minutes instead of 3 weeks. Product management will never go back."

**Option 2 (question)**:
> "What if you could talk to every customer, read every review and analyze every support ticket - and finish before your morning coffee is done?"

**Option 3 (story)**:
> "Sarah spent two weeks building the wrong feature. Not because she didn't understand her users, but because she couldn't process the patterns hidden in hundreds of interviews."

### Example 4: Section-by-section feedback

**User**: "I just finished the 'Common mistakes' section. What do you think?"

**Reply**:
```markdown
# Feedback: Common mistakes

## What works well ✓
- Strong example (the Slack notification story)
- Clear structure (3 mistakes, neatly laid out)
- Each mistake comes with practical advice

## Suggestions for improvement

### Be more specific
The second point, "poor prioritization", could be stronger:

Original:
> "Many teams prioritize poorly, focusing on features instead of outcomes."

Suggested:
> "I've seen a team ship 14 features in one quarter without moving a single core metric. They mistook activity for progress."

### Add data
The third mistake would be more convincing with data:
> "[Add citation]: research shows teams that don't talk to users regularly are 3x more likely to build useless features [source to be added]"

### Optimize the order
Consider reordering: mistake 3 -> mistake 2 -> mistake 1
This builds from smallest to largest, strengthening the piece layer by layer.

Ready to move on to the next section!
```

## Writing workflows

### Blog post workflow
1. Outline together
2. Research the key points
3. Write the introduction -> get feedback
4. Write the body sections -> feedback section by section
5. Write the conclusion -> final review
6. Polish and finalize

### Newsletter workflow
1. Discuss opening ideas
2. Quickly outline (shorter piece)
3. Write the whole draft in one go
4. Review clarity and links
5. Quick polish

### Technical tutorial workflow
1. List the steps
2. Write the code examples
3. Add explanatory text
4. Test the procedure
5. Add a troubleshooting section
6. Final review for accuracy

### In-depth opinion piece workflow
1. Brainstorm to find a distinctive angle
2. Research existing views
3. Distill the core argument
4. Write with a clear stance
5. Add supporting evidence
6. Polish the ending

## Practical tips

1. **Write in VS Code**: better suited to long-form writing than a web interface
2. **One section at a time**: get feedback step by step
3. **Keep research separate**: maintain a research.md file
4. **Version your drafts**: article-v1.md, article-v2.md and so on
5. **Read aloud**: use the feedback to find awkward sentences
6. **Set a deadline**: "I want to finish the first draft today"
7. **Take breaks**: write a bit, get feedback, pause, then revise

## File organization

For writing projects, use this directory structure:

```
your-project/
├── outline.md          # Outline
├── research.md         # Research notes and citations
├── draft-v1.md         # First draft
├── draft-v2.md         # Revised draft
├── final.md            # Final version
├── feedback.md         # Collected feedback
└── sources/            # Reference material
    ├── study1.pdf
    └── article2.md
```

## Best practices

### Research
- Verify that a source is reliable before citing it
- Use the most recent data where possible
- Include different perspectives
- Provide links to original sources

### Feedback
- Say what kind of feedback you want: "Is this section too technical?"
- Share your concerns: "I'm worried this section drags"
- Ask questions: "Does this logic hold together?"
- Ask for alternatives: "Can you explain this another way?"

### Style
- Provide samples of your existing writing
- State your tone preferences
- Flag it when a style fits: "This sounds just like me!"
- Point it out when one doesn't: "Too formal, not my style"

## Related use cases

- Generating social media content from an article
- Rewriting content for different audiences
- Writing email newsletters
- Writing technical documentation
- Creating presentation content
- Writing case studies
- Developing course outlines
