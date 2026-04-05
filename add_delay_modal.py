delay_modal_html = '''
<!-- ══════════════════════════════════════════════
     LOG DELAY / DEFICIENCY / ISSUE MODAL
══════════════════════════════════════════════ -->
<div id="delay-modal" class="modal-overlay hidden">
  <div class="modal" style="max-width:560px;width:95vw">
    <div class="modal-header">
      <h3>⚠️ Log Delay / Deficiency / Issue</h3>
      <button class="modal-close" onclick="closeModal('delay-modal')">✕</button>
    </div>
    <div class="modal-body">
      <form id="delay-form" onsubmit="submitDelay(event)">
        <div class="form-row">
          <div class="form-group">
            <label>Type *</label>
            <select name="type" id="delay-type" required>
              <option value="">Select type...</option>
              <option value="delay">⏱ Schedule Delay</option>
              <option value="deficiency">🔴 Deficiency / Defect</option>
              <option value="safety">🦺 Safety Concern</option>
              <option value="material">📦 Material / Supply Issue</option>
              <option value="weather">🌧 Weather Delay</option>
              <option value="labour">👷 Labour / Crew Issue</option>
              <option value="equipment">🔧 Equipment Breakdown</option>
              <option value="design">📐 Design / Drawing Issue</option>
              <option value="inspection">🔍 Inspection Hold</option>
              <option value="other">📋 Other</option>
            </select>
          </div>
          <div class="form-group">
            <label>Severity *</label>
            <select name="severity" id="delay-severity" required>
              <option value="low">🟡 Low — Minor impact</option>
              <option value="medium" selected>🟠 Medium — Moderate impact</option>
              <option value="high">🔴 High — Significant impact</option>
              <option value="critical">🚨 Critical — Stop work</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Project *</label>
          <select name="project_id" id="delay-project" required>
            <option value="">Select project...</option>
          </select>
        </div>
        <div class="form-group">
          <label>Title / Summary *</label>
          <input type="text" name="title" id="delay-title" placeholder="Brief description of the issue" required>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" id="delay-description" rows="3" placeholder="Detailed description of the delay or deficiency, what happened and why..."></textarea>
        </div>
        <div id="delay-days-row" class="form-row" style="display:none">
          <div class="form-group">
            <label>Days of Delay Impact</label>
            <input type="number" name="delay_days" id="delay-days" min="0" value="1" placeholder="0">
          </div>
          <div class="form-group">
            <label>Auto-adjust Task Dates?</label>
            <select name="auto_adjust" id="delay-auto-adjust">
              <option value="yes">✅ Yes — push all future task dates</option>
              <option value="no">No — log only, adjust manually</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Date Occurred</label>
            <input type="date" name="date" id="delay-date">
          </div>
          <div class="form-group">
            <label>Responsible Party</label>
            <input type="text" name="responsible_party" placeholder="Who is responsible? (optional)">
          </div>
        </div>
        <div class="form-group">
          <label>Corrective Action Required</label>
          <input type="text" name="corrective_action" placeholder="What needs to be done to resolve this?">
        </div>
        <div class="form-group">
          <label>Status</label>
          <select name="status">
            <option value="open">🔴 Open</option>
            <option value="inprogress">🔧 In Progress</option>
            <option value="resolved">✅ Resolved</option>
          </select>
        </div>
        <div class="modal-footer" style="padding:0;margin-top:16px">
          <button type="button" class="btn btn-outline" onclick="closeModal('delay-modal')">Cancel</button>
          <button type="submit" class="btn btn-primary">⚠️ Log Issue</button>
        </div>
      </form>
    </div>
  </div>
</div>

'''

with open('web/app.html', 'r') as f:
    content = f.read()

marker = '<!-- New Invoice Modal -->'
if marker not in content:
    print("ERROR: marker not found!")
else:
    idx = content.find(marker)
    new_content = content[:idx] + delay_modal_html + content[idx:]
    with open('web/app.html', 'w') as f:
        f.write(new_content)
    print(f"Done. Added delay modal ({len(delay_modal_html)} chars)")
    print(f"New file size: {len(new_content)} chars")