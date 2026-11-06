export type Role = 'student'|'reviewer'|'content_manager'|'super_admin'|'ai_agent';
export type ContentAction = 'submit_review'|'approve'|'publish'|'retire';
const permissions: Record<ContentAction, readonly Role[]> = {
 submit_review:['reviewer','content_manager','super_admin','ai_agent'],
 approve:['reviewer','content_manager','super_admin'],
 publish:['content_manager','super_admin'],
 retire:['content_manager','super_admin'],
};
export function requirePermission(role: Role, action: ContentAction) {
 if (!permissions[action].includes(role)) throw new Error('FORBIDDEN');
}
