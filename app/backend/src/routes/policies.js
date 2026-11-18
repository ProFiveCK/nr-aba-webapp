/**
 * Policies & Procedures. Reading needs only a signed-in account; writing and
 * publishing need their ticks. The rules themselves are in services/policies.js.
 */
import express from 'express';
import { PERMISSIONS } from '../config.js';
import { POLICY_ATTACHMENT_ENDINGS, POLICY_WORD_ENDINGS, policyUpload } from '../middleware/upload.js';
import { actorFrom } from '../services/auditService.js';
import { requireAuth, requirePermission } from '../services/authService.js';
import {
  addPolicyFile,
  createPolicy,
  deletePolicy,
  discardDraft,
  getPolicy,
  getPolicyVersion,
  importWordDocument,
  listPolicies,
  policyMeta,
  publishDraft,
  readPolicyFile,
  restorePolicy,
  retirePolicy,
  saveDraft,
  updatePolicyDetails,
} from '../services/policies.js';

const router = express.Router();

const signedIn = requireAuth();
const canEdit = requirePermission(PERMISSIONS.POLICY_EDIT);
const canPublish = requirePermission(PERMISSIONS.POLICY_PUBLISH);

/** The signed-in account as the service and the audit log want it. */
const actor = (req) => ({ ...req.user, ...actorFrom(req) });

router.get('/meta', signedIn, async (req, res) => {
  res.json(await policyMeta(req.user));
});

router.get('/', signedIn, async (req, res) => {
  res.json(await listPolicies(req.user, req.query));
});

router.post('/', canEdit, async (req, res) => {
  res.status(201).json(await createPolicy(actor(req), req.body ?? {}));
});

// Registered before '/:id' so "files" is never read as a document id.
router.get('/files/:fileId', signedIn, async (req, res) => {
  const file = await readPolicyFile(req.user, req.params.fileId);
  // Pictures are shown in the page; anything else is saved, never opened in
  // the portal's own window.
  const ascii = file.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.set({
    'Content-Type': file.content_type,
    'Content-Length': String(file.byte_size),
    'Content-Disposition': `${file.is_picture ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    'X-Content-Type-Options': 'nosniff',
    // A stored file never changes; a new one gets a new address.
    'Cache-Control': 'private, max-age=86400',
  });
  res.send(file.file_data);
});

router.get('/:id', signedIn, async (req, res) => {
  res.json(await getPolicy(req.user, req.params.id));
});

router.patch('/:id', canEdit, async (req, res) => {
  res.json(await updatePolicyDetails(actor(req), req.params.id, req.body ?? {}));
});

router.delete('/:id', canEdit, async (req, res) => {
  await deletePolicy(actor(req), req.params.id);
  res.status(204).end();
});

router.get('/:id/versions/:versionId', signedIn, async (req, res) => {
  res.json(await getPolicyVersion(req.user, req.params.id, req.params.versionId));
});

router.put('/:id/draft', canEdit, async (req, res) => {
  res.json(await saveDraft(actor(req), req.params.id, req.body ?? {}));
});

router.delete('/:id/draft', canEdit, async (req, res) => {
  const revision = req.query.revision === undefined ? null : Number(req.query.revision);
  res.json(await discardDraft(actor(req), req.params.id, { revision }));
});

router.post('/:id/publish', canPublish, async (req, res) => {
  res.json(await publishDraft(actor(req), req.params.id, req.body ?? {}));
});

router.post('/:id/withdraw', canPublish, async (req, res) => {
  res.json(await retirePolicy(actor(req), req.params.id, req.body ?? {}));
});

router.post('/:id/restore', canPublish, async (req, res) => {
  res.json(await restorePolicy(actor(req), req.params.id));
});

router.post(
  '/:id/files',
  canEdit,
  policyUpload(POLICY_ATTACHMENT_ENDINGS, 'a PDF, Word, Excel or PowerPoint file, or a PNG, JPEG, GIF or WebP picture'),
  async (req, res) => {
    res.status(201).json(await addPolicyFile(actor(req), req.params.id, req.policyFile));
  },
);

router.post(
  '/:id/import-word',
  canEdit,
  policyUpload(POLICY_WORD_ENDINGS, 'a Word document saved as .docx (open an older .doc in Word and save it as .docx first)'),
  async (req, res) => {
    res.json(await importWordDocument(actor(req), req.params.id, req.policyFile));
  },
);

export default router;
