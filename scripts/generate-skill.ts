import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('=== VoiceClaw Skill Generator ===\n');

  const name = await askQuestion('Skill Name (e.g. Gmail Agent): ');
  if (!name.trim()) {
    console.error('Skill Name is required.');
    process.exit(1);
  }

  // Convert "Gmail Agent" to "gmail-agent" for ID and filename
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  
  // Convert "Gmail Agent" to "GmailAgentSkill" for Class Name
  const classNameMatch = name.replace(/[^a-zA-Z0-9 ]/g, '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const className = `${classNameMatch}Skill`;

  const description = await askQuestion('Short Description: ');
  const trigger = await askQuestion('Trigger Description (When should the router use this?): ');

  const template = `import { BaseSkill, SkillDefinition } from './base-skill';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// TODO: Define your specific tools here
const exampleTool = tool(
  async ({ input }) => {
    return \`Processed: \${input}\`;
  },
  {
    name: '${id.replace(/-/g, '_')}_tool',
    description: 'An example tool for the ${name} skill.',
    schema: z.object({
      input: z.string().describe('Input string from the user')
    })
  }
);

export default class ${className} extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: '${id}',
      name: '${name}',
      description: '${description.replace(/'/g, "\\'")}',
      triggerDescription: '${trigger.replace(/'/g, "\\'")}',
      systemPrompt: 
        'You are an expert ${name} assistant. \\n' +
        'Use your provided tools to fulfill the user\\'s request. \\n' +
        'Respond naturally and concisely.',
      tools: [exampleTool],
      enabled: true // Set to false to disable this skill temporarily
    };
  }
}
`;

  const skillsDir = path.join(process.cwd(), 'src', 'skills');
  const filePath = path.join(skillsDir, `${id}.ts`);

  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  if (fs.existsSync(filePath)) {
    console.error(`\\nError: Skill file already exists at ${filePath}`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, template, 'utf-8');
  console.log(`\\nSUCCESS: Skill created at ${filePath}`);
  console.log('The LangGraph agent will automatically discover and route to this skill on reboot!');
  
  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
