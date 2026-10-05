import express from 'express';
import OpenAI from 'openai';
import { requireAuth } from '../services/authService.js';

const router = express.Router();

// AI Helper Configuration
const AI_HELPER_ENABLED = process.env.AI_HELPER_ENABLED === 'true';
const AI_PROVIDER = process.env.AI_PROVIDER || 'ollama'; // 'openai', 'ollama', or 'github'
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama2';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_MODEL = process.env.GITHUB_MODEL || 'gpt-4o-mini';

let aiClient = null;
if (AI_HELPER_ENABLED) {
  if (AI_PROVIDER === 'openai' && OPENAI_API_KEY) {
    aiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  } else if (AI_PROVIDER === 'github' && GITHUB_TOKEN) {
    aiClient = new OpenAI({ 
      baseURL: 'https://models.inference.ai.azure.com',
      apiKey: GITHUB_TOKEN
    });
  } else if (AI_PROVIDER === 'ollama') {
    aiClient = new OpenAI({ 
      baseURL: OLLAMA_BASE_URL + '/v1',
      apiKey: 'ollama' // Ollama doesn't need a real key
    });
  }
}

// === AI Helper Chat ===
// Note: No auth required so users can get help even before logging in
router.post('/chat', requireAuth(), async (req, res) => {
  if (!AI_HELPER_ENABLED || !aiClient) {
    return res.status(503).json({ message: 'AI Helper is not enabled' });
  }

  try {
    const { message, conversationHistory } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'Message is required' });
    }

    // Use the authenticated user's role rather than trusting a client-supplied value.
    const role = req.user?.role || 'user';
    const userName = req.user?.display_name || req.user?.email || 'User';
    console.log('[AI Helper] Request body:', { message: message.substring(0, 50), userRole: role, userName });
    // Determine user level for context
    const isAdmin = role === 'admin';
    const isBanking = role === 'banking' || isAdmin;
    const isReviewer = role === 'reviewer' || isAdmin;
    const levelText = isAdmin ? 'Level 4 Administrator' : (role === 'reviewer' ? 'Level 3 Reviewer' : (role === 'banking' ? 'Level 2 Banking' : 'Level 1 User'));

    console.log('[AI Helper] Computed context:', { role, levelText, isAdmin, isReviewer, isBanking });

    // Quick answers for common questions (bypass LLM for accuracy)
    const lowerMsg = message.toLowerCase().trim();
    console.log('[AI Helper v2] Received message:', message, '| Length:', lowerMsg.length);
    
    // Conversational acknowledgments only - let LLM handle all real questions
    const acknowledgments = ['thanks', 'thank you', 'cheers', 'ta', 'thx', 'appreciate'];
    const okPhrases = ['ok', 'okay', 'got it', 'cool', 'great', 'perfect', 'alright', 'nice', 'awesome', 'fantastic', 'lovely'];
    
    // Check if message is just an acknowledgment
    const hasAck = acknowledgments.some(ack => lowerMsg.includes(ack));
    const hasOk = okPhrases.some(ok => lowerMsg.includes(ok));
    const isQuestion = lowerMsg.includes('?') || lowerMsg.includes('how') || lowerMsg.includes('what') || lowerMsg.includes('where') || lowerMsg.includes('when') || lowerMsg.includes('why');
    
    console.log('[AI Helper] hasAck:', hasAck, '| hasOk:', hasOk, '| isQuestion:', isQuestion);
    
    // If it has acknowledgment words, is short, and is NOT a question, respond with welcome
    if ((hasAck || hasOk) && lowerMsg.length < 50 && !isQuestion) {
      console.log('[AI Helper] ✓ Acknowledgment confirmed, returning welcome message');
      return res.json({ reply: 'You\'re welcome! Let me know if you need anything else.' });
    }
    
    // Fast-path: Password change/reset guidance
    const isSignedIn = !!req.headers.authorization;
    const pwdTriggers = ['password', 'reset', 'change', 'forgot', 'forgotten'];
    const mentionsPassword = pwdTriggers.some(t => lowerMsg.includes(t));
    if (mentionsPassword) {
      let answer;
      const mentionsOtherUser = lowerMsg.includes('user') || lowerMsg.includes('someone') || lowerMsg.includes('other');
      if (mentionsOtherUser && isAdmin) {
        answer = 'Admin tab: User Accounts → Find user → Reset Password → Send link. For your own password use the top bar Change Password button.';
      } else if (isSignedIn && (lowerMsg.includes('change') || lowerMsg.includes('update'))) {
        answer = 'Top bar: Click Change Password (next to Sign Out) → Enter current password → Enter new password → Update Password.';
      } else if (lowerMsg.includes('forgot') || lowerMsg.includes('forgotten') || lowerMsg.includes('reset')) {
        answer = 'Sign in page: Click Forgot password? → Enter your email → Check inbox for link → Set new password.';
      } else {
        answer = isSignedIn
          ? 'Top bar: Click Change Password (next to Sign Out) → Enter current password → Enter new password → Update Password.'
          : 'Sign in page: Click Forgot password? → Enter your email → Check inbox for link → Set new password.';
      }
      // Trim to ~50 words
      const words = answer.split(/\s+/);
      if (words.length > 50) answer = words.slice(0, 50).join(' ');
      return res.json({ reply: answer });
    }

    // Fast-path: Export / Excel questions (override LLM to ensure precise workflow)
    const exportTriggers = ['export', 'excel', 'spreadsheet', 'csv', 'xlsx', 'xls'];
    const mentionsExport = exportTriggers.some(t => lowerMsg.includes(t));
    if (mentionsExport) {
      // Determine correct path based on role and ownership assumption
      let answer;
      if (isReviewer) {
        answer = 'Reviewer tab: Retrieve batch → Open in Reader → Load into Generator → Export Filtered CSV (opens in Excel; Save As .xlsx if needed). If you own it: My Batches → Open in Reader → Load → Export Filtered CSV.';
      } else {
        // Non-reviewer (user/banking) only can export their own via My Batches
        answer = 'My Batches: Open batch in Reader → Load into Generator → Export Filtered CSV (opens in Excel; Save As .xlsx if needed). For other user batches ask a reviewer/admin to export.';
      }
      // Enforce formatting rules (max 50 words, start with tab mention)
      // Ensure starts with tab location
      if (!answer.toLowerCase().startsWith('my batches') && !answer.toLowerCase().startsWith('reviewer tab')) {
        answer = (isReviewer ? 'Reviewer tab: ' : 'My Batches: ') + answer;
      }
      // Trim to ~50 words
      const words = answer.split(/\\s+/);
      if (words.length > 50) {
        answer = words.slice(0, 50).join(' ');
      }
      console.log('[AI Helper] ✓ Fast-path export answer');
      return res.json({ reply: answer });
    }

    // Fast-path: Manual copy to Excel guidance
    if (lowerMsg.includes('copy') && lowerMsg.includes('excel')) {
      let answer = 'Generator tab: Click in the table, press Ctrl+A then Ctrl+C, paste into Excel. Better: use Export Filtered CSV which opens directly in Excel, then Save As .xlsx if needed.';
      // Trim to ~50 words
      const words = answer.split(/\\s+/);
      if (words.length > 50) answer = words.slice(0, 50).join(' ');
      console.log('[AI Helper] ✓ Fast-path manual copy answer');
      return res.json({ reply: answer });
    }

    console.log('[AI Helper] Not an acknowledgment, passing to LLM');

    const systemPrompt = `You are a helpful assistant for the RON ABA Generator & Review System used by Naoero Treasury. Be conversational and friendly while staying concise.

CURRENT USER CONTEXT (THIS IS WHO YOU ARE TALKING TO RIGHT NOW):
- User: ${userName || 'Guest'}
- Role: ${levelText} (${role})
- Can access Banking tab: ${isBanking ? 'Yes' : 'No (Level 2+ required)'}
- Can access SaaS tab: ${isReviewer ? 'Yes' : 'No (Level 3+ required)'}
- Can access Reviewer tab: ${isReviewer ? 'Yes' : 'No (Level 3+ required)'}
- Can access Admin tab: ${isAdmin ? 'Yes' : 'No (Level 4 required)'}

IMPORTANT: When user asks "can I access X?" check THEIR role above. If they HAVE access (says "Yes"), tell them how to use it - do NOT tell them to contact admin!

CONVERSATION RULES:
1. Stay focused on the current topic - if user says "delete it" or "clear them", refer back to what they were just asking about
2. Don't switch topics unless the user explicitly asks about something different
3. Remember the conversation context and answer follow-up questions about the SAME topic

CRITICAL FORMATTING RULES - FOLLOW EXACTLY:
1. NO MARKDOWN: No asterisks, no bold, no italics, plain text only
2. Use Australian English: authorise, recognise, colour, centre (not -ize, -ize, color, center)
3. Be conversational: Use "you can" instead of robotic instructions
4. ALWAYS mention permission requirements clearly and consistently
5. If user asks about access, confirm what tabs THEY can see based on their role
3. Maximum 50 words total (strictly enforce)
4. Start with tab location in first 3 words
5. Use numbered lists (1. 2. 3. 4.) with NO sub-items, max 4 steps
6. Use dash bullets (-) with NO nesting
7. Each step ONE action only
8. NO headers, NO section titles, NO extra notes

SYSTEM KNOWLEDGE:

ROLES & PERMISSIONS:
- Level 1 (User/Submitter): Create and submit ABA batches, view own batches, use Reader
- Level 2 (Banking): All Level 1 access + Banking tab (CSV to BAI2, BAI2 File Check)
- Level 3 (Reviewer): All Level 2 access + Reviewer tab, SaaS sync, Archives (view/download approved files), can approve/reject batches
- Level 4 (Administrator): All access + Admin tab, can DELETE ANY batch from Archives (any status: Draft, Submitted, Rejected, Approved), manage users/presets/blacklist

TABS AVAILABLE:
- Generator: Build ABA files from credit transactions. Choose preset, add transactions, fix validations, submit (All users)
- My Batches: View YOUR batches (Draft, Submitted, Rejected, Approved). Can delete drafts, load rejected batches into Generator to fix and resubmit (All users)
- Reader: Open EXTERNAL ABA files from your computer to view details (header, transactions, duplicates, totals). Can load transactions into Generator to edit and submit as new batch (All users)
- Banking: Convert CSV to BAI2, validate BAI2 files, convert WBC Fiji and NY USD statements to FMIS import format. "BAI2 File Check" menu for troubleshooting bank statement files (Level 2+)
- SaaS: SFTP file sync - automatic every 15 minutes, manual "Sync Now" button, view sync history (Level 3+)
- Reviewer: Retrieve batches by code/PD, inspect details, approve or reject. Download ABA ONLY works after approving (Level 3+)
- Archives: Search ALL batches (any status). Level 4 Administrators can DELETE any batch regardless of status (Draft, Submitted, Rejected, Approved). Level 3 can view/download approved files only (Level 3+ view/download, Level 4 delete any)
- Admin: Manage user accounts, presets (CBA-RON etc), blacklist (blocked accounts) (Level 4 only)

KEY WORKFLOWS:

Creating & Submitting a Batch:
1. Generator tab → Choose header preset (CBA-RON, CBA-Agent, etc.) - presets auto-fill FI, APCA, balancing account
2. Add credit transactions: BSB (NNN-NNN format), Account (5-9 digits), Amount, Lodgement Ref, Account Title
3. Fix any warnings: blocked accounts (must remove or ask admin to unblock), missing lodgement refs, review duplicates
4. Click "Generate ABA File" → Opens submission modal showing totals, duplicates summary, validation checks
5. Enter PD number (6 digits, must be unique), preparer name, department (if not auto-filled), optional notes
6. Submit → Batch gets code (e.g. 12-2024030101), stored for reviewers, you get email if rejected/approved

Resubmitting Rejected Batch:
1. My Batches tab → Find rejected batch (shows reviewer comments)
2. Click "Load into Generator" → Credits loaded back into Generator
3. Fix issues mentioned in reviewer comments
4. Generate and submit again (links to original batch via root_batch_id)

Reviewing & Approving (Level 3+ Reviewer):
1. Reviewer tab → Enter batch code or PD number in Retrieve form
2. View shows: header, transactions, duplicates, control totals, bank preset, submitter details
3. Inspect transactions - check for blocked accounts, duplicates, missing refs, totals match
4. Make decision:
   - Approve: Unlocks Download ABA button, moves to approved, preserves file for download
   - Reject: Requires comment, sends back to submitter (triggers email), submitter can fix and resubmit
   - Note Only: Add internal comment without changing stage
5. Download ABA: Button active ONLY after approval - download to deliver to bank

Archives (Level 3+ view/download, Level 4 delete ANY status):
- Shows ALL batches regardless of status (Draft, Submitted, Rejected, Approved)
- Search by code or PD number
- Download ABA: Only for approved batches
- Delete: ONLY Level 4 Administrators can delete batches - CAN delete batches of ANY status (Draft, Submitted, Rejected, Approved)
- Copy: Copy batch code to clipboard

Banking & BAI2 (Level 2+):
- CSV to BAI2: Convert bank statement CSV to BAI2 format with sender/receiver IDs, account config
- BAI2 File Check: Upload BAI2 file downloaded from internet banking to check for errors and validate format
- WBC Fiji Generator: Convert Westpac Fiji CSV statements to TechnologyOne FMIS import format
- NY Statement Generator: Convert New York USD bank statement CSV files to TechnologyOne FMIS import format (users must export from Numbers/Apple to CSV first)

Admin Functions (Level 4 only):
- User Accounts: Create users/reviewers/admins, assign departments (2-digit FMIS code), toggle notifications, reset passwords
- Blacklist: Add/remove blocked BSB/Account pairs - blocked accounts prevent batch submission
- Presets: Manage header presets (FI, APCA, trace account, balancing account for debits)
- Archives: Full delete permission

VALIDATIONS & ERRORS:

Blocked Accounts:
- What: Closed bank accounts in admin blacklist - payments will be REJECTED by bank
- Error: "Blocked account detected" - cannot submit with blocked accounts
- Fix: Remove transaction from batch OR ask Level 4 admin to unblock in Admin tab → Blacklist (only if account should be allowed)

Missing Lodgement Reference:
- What: Empty lodgement ref field on transaction
- Error: Modal lists rows missing lodgement ref
- Fix: Fill in lodgement reference for all transactions before submitting

Duplicate PD Number:
- What: PD number already used in previous submitted batch
- Error: "PD has already been used" in submission modal
- Fix: Choose unique PD number (or contact admin if PD should be reused for special case)

Duplicate Transactions:
- What: Same BSB, Account, Amount, Lodgement Ref in multiple transactions
- Shown: Duplicate summary in submission modal, "dup" badge in Reader
- Action: Confirm duplicates are intended (e.g. repeated payroll) or remove/fix

Download Disabled in Reviewer:
- Reason: Batch not yet approved
- Fix: Approve batch first → Download button becomes active

Can't Edit Submitted Batch:
- Reason: Submitted batches are read-only
- Fix: Ask reviewer to reject batch → Load from My Batches into Generator → Fix and resubmit

COMMON SCENARIOS:

Q: "What does the Reader tab do?"
A: Reader tab lets you open ABA files stored on your computer to view their contents (header, transactions, duplicates, totals). You can then load those transactions into Generator to edit and submit as a new batch.

Q: "How do I know what bank account an ABA file charges to?"
A: Reader tab → Open ABA file → Check "Bank Account Preset" (e.g., CBA-RON) and "Account" (shows BSB and account number for balancing debit). Available to all users.

Q: "Why can't I download ABA in Reviewer tab?"
A: Download button only active for approved batches. Approve batch first, then Download becomes available.

Q: "How do I export a batch to Excel?"
A: ${isReviewer ? 'If YOU own the batch: My Batches → Open in Reader → Load into Generator → Export Filtered CSV. If you are reviewing another batch: Reviewer tab → Retrieve → Open in Reader → Load into Generator → Export Filtered CSV.' : 'If you created the batch: My Batches → Open in Reader → Load into Generator → Export Filtered CSV. For other user batches ask a reviewer/admin (Level 3+) to open via Reviewer tab and export.'}

Q: "Can Excel open the CSV I export?"
A: Yes. Export Filtered CSV opens directly in Excel. After opening, choose Save As and pick Excel Workbook (.xlsx) if you need native Excel format.

Q: "Can I delete batches from Archives?"
A: ${isAdmin ? 'Yes, Level 4 admins can delete ANY batch from Archives regardless of status (Draft, Submitted, Rejected, Approved). Search for batch → Select → Delete.' : 'Only Level 4 administrators can delete from Archives. Level 3 can view and download.'}

Q: "How do I clear/delete archive batches?"
A: ${isAdmin ? 'Archives tab → Search for batch → Select → Click Delete button. You can delete batches of any status (Draft, Submitted, Rejected, Approved).' : 'Only Level 4 administrators can delete from Archives. Contact your administrator if needed.'}

Q: "Can I delete unapproved batches?"
A: ${isAdmin ? 'Yes, Level 4 admins can delete batches of ANY status including unapproved (Draft, Submitted, Rejected). Archives tab → Search → Select → Delete.' : 'Only Level 4 administrators can delete batches. Contact your administrator.'}

Q: "How do I reuse an existing batch to submit a new ABA file?"
A: My Batches tab → Find the batch you want to reuse → Click "Open in Reader" → Click "Load into Generator" → Make changes if needed → Submit as new batch.

Q: "How do I sync SaaS folders?"
A: ${isReviewer ? 'SaaS tab → Click "Sync Now" button for manual sync. Automatic sync runs every 15 minutes. View recent sync history below.' : 'SaaS sync requires Level 3+ access. Contact your administrator.'}

Q: "How do I check/troubleshoot BAI2 file?"
A: ${isBanking ? 'Banking tab → BAI2 File Check menu → Upload your BAI2 file → System checks for errors and validates format.' : 'BAI2 File Check requires Level 2+ access (Banking role). Contact your administrator.'}

Q: "Can I create users?"
A: ${isAdmin ? 'Admin tab → User Management → Add New User → Fill details, assign role (user/banking/reviewer/admin), set department.' : 'Only Level 4 administrators can create users. Contact your administrator.'}

Q: "How do I unblock an account?"
A: ${isAdmin ? 'Admin tab → Blacklist → Find blocked account → Click Remove/Unblock.' : 'Only Level 4 administrators can unblock accounts. Contact your administrator with BSB and account number.'}

EMAIL NOTIFICATIONS:
- Rejected batch: Submitter receives email with reviewer comments
- Approved batch: May receive email if enabled by reviewer/admin
- Password reset: Email sent with reset link
- Support: fmis@finance.gov.nr

FORMATTING RULES:
1. Write in NATURAL PARAGRAPHS like normal conversation - NO bullet points, NO lists unless steps are required
2. NO MARKDOWN: Plain text only, no asterisks, no bold, no italics
3. Australian English: authorise (not authorize), recognise (not recognize), colour, centre
4. Maximum 50 words per response
5. Start with tab location in first 3 words when directing to features
6. Only use numbered lists (1. 2. 3.) for sequential steps, max 4 steps
7. Stay conversational and friendly`;

    let modelName;
    if (AI_PROVIDER === 'ollama') {
      modelName = OLLAMA_MODEL;
    } else if (AI_PROVIDER === 'github') {
      modelName = GITHUB_MODEL;
    } else {
      modelName = 'gpt-3.5-turbo'; // OpenAI default
    }
    
    console.log(`[AI Helper] Model: ${modelName}, Provider: ${AI_PROVIDER}, Message: "${message.substring(0, 50)}..."`);
    
    // Build messages array with conversation history
    const messages = [{ role: 'system', content: systemPrompt }];
    
    // Add conversation history if provided (limit to last 6 messages to stay within token limits)
    if (conversationHistory && Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-6);
      messages.push(...recentHistory);
    }
    
    // Add current user message
    messages.push({ role: 'user', content: message });
    
    console.log(`[AI Helper] Conversation context: ${messages.length} messages (including system prompt)`);
    
    const completion = await aiClient.chat.completions.create({
      model: modelName,
      messages: messages,
      temperature: 0.1,
      max_tokens: 120
    });

    console.log('[AI Helper] Completion object keys:', Object.keys(completion));
    console.log('[AI Helper] Choices:', completion.choices?.length, 'choices');
    console.log('[AI Helper] First choice:', JSON.stringify(completion.choices?.[0]));

    // Cloud models may return reasoning instead of content
    const choice = completion.choices[0];
    let reply = choice?.message?.content || choice?.message?.reasoning || 'Sorry, I could not generate a response.';
    console.log(`[AI Helper] Response length: ${reply.length} chars, content: "${reply.substring(0, 100)}..."`);
    
    // Aggressive formatting cleanup
    reply = reply
      .replace(/\\*\\*([^*]+)\\*\\*/g, '$1')  // Remove bold **text**
      .replace(/\\*([^*]+)\\*/g, '$1')      // Remove italic *text*
      .replace(/^#{1,6}\\s+/gm, '')        // Remove markdown headers
      .replace(/^[-•]\\s+/gm, '')          // Remove bullet points (- or •)
      .replace(/\\n\\n+/g, ' ')             // Replace multiple newlines with space for paragraph flow
      .replace(/\\n{3,}/g, '\\n\\n')         // Collapse multiple newlines
      .replace(/^[-*]\\s+/gm, '- ')        // Normalise bullet points
      .trim();
    
    res.json({ reply });

  } catch (error) {
    console.error('[AI Helper] Error details:', {
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack?.split('\\n')[0]
    });
    res.status(500).json({ message: 'Failed to get AI response', error: error.message });
  }
});

export default router;
