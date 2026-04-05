new_pages_html = '''
    <!-- ══════════════════════════════════════════════════════════
         DELAYS & DEFICIENCIES PAGE
    ══════════════════════════════════════════════════════════ -->
    <div id="page-delays" class="page">
      <div class="page-header">
        <h1 class="page-title">⚠️ Delays & Issues</h1>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openDelayModal()">+ Log New Issue</button>
        </div>
      </div>

      <!-- Summary KPIs -->
      <div class="delays-kpi-row" id="delays-kpi-row">
        <div class="delays-kpi"><span class="dkpi-icon">📋</span><span class="dkpi-val" id="dkpi-total">0</span><span class="dkpi-label">Total Logged</span></div>
        <div class="delays-kpi"><span class="dkpi-icon">🚨</span><span class="dkpi-val" id="dkpi-open">0</span><span class="dkpi-label">Open</span></div>
        <div class="delays-kpi"><span class="dkpi-icon">🔧</span><span class="dkpi-val" id="dkpi-inprogress">0</span><span class="dkpi-label">In Progress</span></div>
        <div class="delays-kpi"><span class="dkpi-icon">✅</span><span class="dkpi-val" id="dkpi-resolved">0</span><span class="dkpi-label">Resolved</span></div>
        <div class="delays-kpi"><span class="dkpi-icon">📅</span><span class="dkpi-val" id="dkpi-days">0</span><span class="dkpi-label">Avg Days Impact</span></div>
      </div>

      <!-- Filter bar -->
      <div class="filter-bar" style="margin-bottom:12px">
        <button class="filter-btn active" onclick="filterDelays('all', this)">All</button>
        <button class="filter-btn" onclick="filterDelays('delay', this)">⏱ Delays</button>
        <button class="filter-btn" onclick="filterDelays('deficiency', this)">🔴 Deficiencies</button>
        <button class="filter-btn" onclick="filterDelays('safety', this)">🦺 Safety</button>
        <button class="filter-btn" onclick="filterDelays('material', this)">📦 Material</button>
        <button class="filter-btn" onclick="filterDelays('open', this)">Open</button>
        <button class="filter-btn" onclick="filterDelays('resolved', this)">Resolved</button>
      </div>

      <div id="delays-list" class="delays-list">
        <div class="pm-empty-state">
          <div class="pm-empty-icon">⚠️</div>
          <h3>No Issues Logged</h3>
          <p>Use the <strong>Log Issue</strong> button above or the <strong>⚠️ Log Issue</strong> button in the header to record any delay, deficiency, or safety concern on your projects.</p>
          <button class="btn btn-primary" onclick="openDelayModal()">+ Log First Issue</button>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════
         SAFETY FORMS PAGE
    ══════════════════════════════════════════════════════════ -->
    <div id="page-safety-forms" class="page">
      <div class="page-header">
        <h1 class="page-title">🦺 Safety Forms</h1>
        <div class="page-actions">
          <button class="btn btn-outline btn-sm" onclick="switchSafetyTab('records')">📂 Records</button>
        </div>
      </div>

      <!-- Safety tabs -->
      <div class="pm-tabs safety-tabs">
        <button class="pm-tab active" data-tab="sf-flha" onclick="switchSafetyTab('sf-flha')">FLHA</button>
        <button class="pm-tab" data-tab="sf-fall" onclick="switchSafetyTab('sf-fall')">Fall Arrest</button>
        <button class="pm-tab" data-tab="sf-toolbox" onclick="switchSafetyTab('sf-toolbox')">Tool Box Talk</button>
        <button class="pm-tab" data-tab="sf-incident" onclick="switchSafetyTab('sf-incident')">Incident Report</button>
        <button class="pm-tab" data-tab="sf-inspection" onclick="switchSafetyTab('sf-inspection')">Site Inspection</button>
        <button class="pm-tab" data-tab="sf-records" onclick="switchSafetyTab('sf-records')">📂 Records</button>
      </div>

      <!-- FLHA Tab -->
      <div id="sf-tab-sf-flha" class="pm-tab-content safety-form-tab active">
        <div class="sf-form-header">
          <div>
            <h2>Field Level Hazard Assessment (FLHA)</h2>
            <p>OHS Act compliant — complete before starting work each day</p>
          </div>
          <div class="sf-compliance-badges">
            <span class="sf-badge">✅ OHS Act</span>
            <span class="sf-badge">✅ WCB</span>
          </div>
        </div>
        <form id="form-flha" class="safety-form" onsubmit="submitSafetyForm(event,'flha')">
          <div class="sf-section">
            <h3>Job Information</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Date</label><input type="date" name="date" required></div>
              <div class="sf-field"><label>Project / Site</label>
                <select name="project_id">
                  <option value="">Select project...</option>
                </select>
              </div>
              <div class="sf-field"><label>Foreman / Supervisor</label><input type="text" name="foreman" placeholder="Your name" required></div>
              <div class="sf-field"><label>Company</label><input type="text" name="company" placeholder="Company name"></div>
              <div class="sf-field"><label>Work Location / Address</label><input type="text" name="location" placeholder="Site address" required></div>
              <div class="sf-field"><label>Crew Size</label><input type="number" name="crew_size" min="1" value="1"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Tasks to be Performed</h3>
            <textarea name="tasks" rows="3" placeholder="List all tasks to be performed today..." required class="sf-textarea"></textarea>
          </div>

          <div class="sf-section">
            <h3>Hazard Identification & Controls</h3>
            <p class="sf-help-text">For each hazard identified, describe the control measure to eliminate or reduce the risk.</p>
            <div id="flha-hazards">
              <div class="sf-hazard-row">
                <div class="sf-field flex-1"><label>Hazard</label><input type="text" name="hazard[]" placeholder="e.g. Working at heights"></div>
                <div class="sf-field flex-1"><label>Control Measure</label><input type="text" name="control[]" placeholder="e.g. Fall arrest system, guardrails"></div>
                <div class="sf-field w-120"><label>Risk Level</label>
                  <select name="risk_level[]">
                    <option>Low</option><option>Medium</option><option selected>High</option>
                  </select>
                </div>
              </div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" onclick="addHazardRow()">+ Add Hazard</button>
          </div>

          <div class="sf-section">
            <h3>PPE Required</h3>
            <div class="sf-checkbox-grid">
              <label class="sf-check"><input type="checkbox" name="ppe" value="hard_hat" checked> 🪖 Hard Hat</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="safety_vest" checked> 🦺 Safety Vest</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="safety_boots" checked> 👢 Safety Boots</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="safety_glasses"> 🥽 Safety Glasses</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="gloves"> 🧤 Gloves</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="hearing_protection"> 🎧 Hearing Protection</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="fall_arrest"> 🔒 Fall Arrest Harness</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="respirator"> 😷 Respirator / Mask</label>
              <label class="sf-check"><input type="checkbox" name="ppe" value="face_shield"> 🛡 Face Shield</label>
            </div>
          </div>

          <div class="sf-section">
            <h3>Emergency Information</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Nearest Hospital</label><input type="text" name="hospital" placeholder="Hospital name / address"></div>
              <div class="sf-field"><label>Emergency Contact</label><input type="text" name="emergency_contact" placeholder="Name and phone number"></div>
              <div class="sf-field"><label>First Aid Kit Location</label><input type="text" name="first_aid_location" placeholder="Where is the first aid kit?"></div>
              <div class="sf-field"><label>Muster Point</label><input type="text" name="muster_point" placeholder="Emergency assembly point"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Worker Acknowledgment</h3>
            <p class="sf-help-text">All workers have been briefed on the hazards and controls listed above.</p>
            <div id="flha-signatures">
              <div class="sf-sig-row">
                <input type="text" name="worker_name[]" placeholder="Worker name" class="sf-sig-name">
                <input type="text" name="worker_trade[]" placeholder="Trade / Role">
                <label class="sf-check compact"><input type="checkbox" name="worker_ack[]"> Acknowledged</label>
              </div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" onclick="addSignatureRow('flha-signatures')">+ Add Worker</button>
          </div>

          <div class="sf-section">
            <h3>Additional Notes</h3>
            <textarea name="notes" rows="2" class="sf-textarea" placeholder="Any additional safety notes or site conditions..."></textarea>
          </div>

          <div class="sf-submit-row">
            <div class="sf-email-note">📧 Form will be emailed to company contacts and saved to Records.</div>
            <div class="sf-submit-actions">
              <button type="button" class="btn btn-outline" onclick="previewSafetyForm('flha')">👁 Preview</button>
              <button type="submit" class="btn btn-primary">✅ Submit FLHA</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Fall Arrest Tab -->
      <div id="sf-tab-sf-fall" class="pm-tab-content safety-form-tab">
        <div class="sf-form-header">
          <div>
            <h2>Fall Arrest / Working at Heights Inspection</h2>
            <p>Complete before any work at heights over 3 metres (OHS Regulation Part 9)</p>
          </div>
          <div class="sf-compliance-badges">
            <span class="sf-badge">✅ OHS Part 9</span>
            <span class="sf-badge">✅ WCB</span>
          </div>
        </div>
        <form id="form-fall" class="safety-form" onsubmit="submitSafetyForm(event,'fall')">
          <div class="sf-section">
            <h3>Job Information</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Date</label><input type="date" name="date" required></div>
              <div class="sf-field"><label>Project / Site</label><select name="project_id"><option value="">Select project...</option></select></div>
              <div class="sf-field"><label>Worker Name</label><input type="text" name="worker_name" required></div>
              <div class="sf-field"><label>Supervisor</label><input type="text" name="supervisor"></div>
              <div class="sf-field"><label>Work Height (metres)</label><input type="number" name="height" step="0.1" min="0"></div>
              <div class="sf-field"><label>Type of Work</label><input type="text" name="work_type" placeholder="e.g. Roof framing, scaffold erection"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Fall Protection Equipment Inspection</h3>
            <div class="sf-inspection-list">
              <label class="sf-inspect-item"><input type="checkbox" name="harness_inspect" value="pass"> Full body harness — inspected, no damage, correct fit</label>
              <label class="sf-inspect-item"><input type="checkbox" name="lanyard_inspect" value="pass"> Lanyard / SRL — inspected, no fraying or damage</label>
              <label class="sf-inspect-item"><input type="checkbox" name="anchor_inspect" value="pass"> Anchor point — rated min. 5,000 lbs, properly installed</label>
              <label class="sf-inspect-item"><input type="checkbox" name="connectors_inspect" value="pass"> Connectors / carabiners — no damage, gates function properly</label>
              <label class="sf-inspect-item"><input type="checkbox" name="rescue_inspect" value="pass"> Rescue plan in place and communicated to crew</label>
              <label class="sf-inspect-item"><input type="checkbox" name="ladder_inspect" value="pass"> Ladders secured, 3-point contact maintained (if applicable)</label>
              <label class="sf-inspect-item"><input type="checkbox" name="scaffold_inspect" value="pass"> Scaffolding guardrails installed and secured (if applicable)</label>
              <label class="sf-inspect-item"><input type="checkbox" name="perimeter_inspect" value="pass"> Perimeter protection / safety nets in place (if applicable)</label>
            </div>
          </div>

          <div class="sf-section">
            <h3>Equipment Details</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Harness Manufacturer / Model</label><input type="text" name="harness_model"></div>
              <div class="sf-field"><label>Harness Serial #</label><input type="text" name="harness_serial"></div>
              <div class="sf-field"><label>Last Inspection Date</label><input type="date" name="last_inspection"></div>
              <div class="sf-field"><label>Next Due Date</label><input type="date" name="next_inspection"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Deficiencies Found</h3>
            <textarea name="deficiencies" rows="3" class="sf-textarea" placeholder="Describe any deficiencies found and corrective actions taken..."></textarea>
          </div>

          <div class="sf-section">
            <h3>Worker Declaration</h3>
            <p class="sf-help-text">I confirm I have inspected my fall protection equipment and found it to be in good working condition. I understand the fall protection plan and rescue procedure.</p>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Worker Signature (type name)</label><input type="text" name="worker_sig" placeholder="Type full name as signature" required></div>
              <div class="sf-field"><label>Supervisor Signature</label><input type="text" name="supervisor_sig" placeholder="Type full name as signature"></div>
            </div>
          </div>

          <div class="sf-submit-row">
            <div class="sf-email-note">📧 Form will be emailed to company contacts and saved to Records.</div>
            <div class="sf-submit-actions">
              <button type="button" class="btn btn-outline" onclick="previewSafetyForm('fall')">👁 Preview</button>
              <button type="submit" class="btn btn-primary">✅ Submit Fall Arrest Form</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Tool Box Talk Tab -->
      <div id="sf-tab-sf-toolbox" class="pm-tab-content safety-form-tab">
        <div class="sf-form-header">
          <div>
            <h2>Tool Box Talk / Safety Meeting</h2>
            <p>Document your daily/weekly safety briefing with crew</p>
          </div>
          <div class="sf-compliance-badges">
            <span class="sf-badge">✅ OHS Act</span>
          </div>
        </div>
        <form id="form-toolbox" class="safety-form" onsubmit="submitSafetyForm(event,'toolbox')">
          <div class="sf-section">
            <h3>Meeting Information</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Date</label><input type="date" name="date" required></div>
              <div class="sf-field"><label>Time</label><input type="time" name="time"></div>
              <div class="sf-field"><label>Project / Site</label><select name="project_id"><option value="">Select project...</option></select></div>
              <div class="sf-field"><label>Meeting Led By</label><input type="text" name="led_by" required></div>
              <div class="sf-field"><label>Duration (minutes)</label><input type="number" name="duration" min="1" value="15"></div>
              <div class="sf-field"><label>Number of Attendees</label><input type="number" name="attendees" min="1" value="1"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Topic(s) Discussed</h3>
            <div class="sf-checkbox-grid">
              <label class="sf-check"><input type="checkbox" name="topics" value="fall_protection"> Fall Protection</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="ppe_use"> PPE Use & Inspection</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="electrical_safety"> Electrical Safety</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="housekeeping"> Site Housekeeping</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="near_miss"> Near Miss Review</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="emergency_procedures"> Emergency Procedures</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="equipment_safety"> Equipment Safety</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="whmis"> WHMIS / Chemical Handling</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="new_hazard"> New Site Hazard</label>
              <label class="sf-check"><input type="checkbox" name="topics" value="weather_conditions"> Weather Conditions</label>
            </div>
            <div class="sf-field" style="margin-top:8px">
              <label>Additional Topic(s)</label>
              <input type="text" name="other_topics" placeholder="Other topics discussed...">
            </div>
          </div>

          <div class="sf-section">
            <h3>Key Points Discussed</h3>
            <textarea name="key_points" rows="4" class="sf-textarea" placeholder="Summarize the key safety points, reminders, and any corrective actions discussed..." required></textarea>
          </div>

          <div class="sf-section">
            <h3>Action Items / Follow-ups</h3>
            <textarea name="action_items" rows="2" class="sf-textarea" placeholder="Any action items or follow-ups required..."></textarea>
          </div>

          <div class="sf-section">
            <h3>Attendee Sign-Off</h3>
            <div id="toolbox-signatures">
              <div class="sf-sig-row">
                <input type="text" name="worker_name[]" placeholder="Worker name" class="sf-sig-name">
                <input type="text" name="worker_trade[]" placeholder="Trade / Role">
                <label class="sf-check compact"><input type="checkbox" name="worker_ack[]"> Present</label>
              </div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" onclick="addSignatureRow('toolbox-signatures')">+ Add Attendee</button>
          </div>

          <div class="sf-submit-row">
            <div class="sf-email-note">📧 Form will be emailed to company contacts and saved to Records.</div>
            <div class="sf-submit-actions">
              <button type="button" class="btn btn-outline" onclick="previewSafetyForm('toolbox')">👁 Preview</button>
              <button type="submit" class="btn btn-primary">✅ Submit Tool Box Talk</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Incident Report Tab -->
      <div id="sf-tab-sf-incident" class="pm-tab-content safety-form-tab">
        <div class="sf-form-header incident-header">
          <div>
            <h2>Incident / Injury Report</h2>
            <p>WCB reportable — submit within 24 hours of incident</p>
          </div>
          <div class="sf-compliance-badges">
            <span class="sf-badge critical">⚠️ WCB Reportable</span>
            <span class="sf-badge">✅ OHS Act</span>
          </div>
        </div>
        <form id="form-incident" class="safety-form" onsubmit="submitSafetyForm(event,'incident')">
          <div class="sf-section">
            <h3>Incident Details</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Date of Incident</label><input type="date" name="incident_date" required></div>
              <div class="sf-field"><label>Time of Incident</label><input type="time" name="incident_time" required></div>
              <div class="sf-field"><label>Project / Site</label><select name="project_id"><option value="">Select project...</option></select></div>
              <div class="sf-field"><label>Location on Site</label><input type="text" name="location" placeholder="Specific location" required></div>
              <div class="sf-field"><label>Type of Incident</label>
                <select name="incident_type" required>
                  <option value="">Select type...</option>
                  <option>Injury — Lost Time</option>
                  <option>Injury — Medical Aid</option>
                  <option>Injury — First Aid Only</option>
                  <option>Near Miss</option>
                  <option>Property Damage</option>
                  <option>Environmental Release</option>
                  <option>Other</option>
                </select>
              </div>
              <div class="sf-field"><label>Severity</label>
                <select name="severity">
                  <option>Minor</option><option>Moderate</option><option>Serious</option><option>Critical</option>
                </select>
              </div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Injured / Involved Person</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Full Name</label><input type="text" name="person_name" required></div>
              <div class="sf-field"><label>Trade / Position</label><input type="text" name="person_trade"></div>
              <div class="sf-field"><label>Company / Employer</label><input type="text" name="person_company"></div>
              <div class="sf-field"><label>Years of Experience</label><input type="number" name="person_experience" min="0"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Description of Incident</h3>
            <textarea name="description" rows="4" class="sf-textarea" placeholder="Describe exactly what happened, in chronological order..." required></textarea>
          </div>

          <div class="sf-section">
            <h3>Body Parts Affected (if injury)</h3>
            <div class="sf-checkbox-grid">
              <label class="sf-check"><input type="checkbox" name="body_parts" value="head"> Head / Skull</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="eyes"> Eyes</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="neck"> Neck</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="shoulder"> Shoulder</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="arm_hand"> Arm / Hand / Wrist</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="back"> Back / Spine</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="torso"> Chest / Torso</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="leg_foot"> Leg / Foot / Ankle</label>
              <label class="sf-check"><input type="checkbox" name="body_parts" value="multiple"> Multiple Areas</label>
            </div>
          </div>

          <div class="sf-section">
            <h3>Immediate Actions Taken</h3>
            <div class="sf-checkbox-grid">
              <label class="sf-check"><input type="checkbox" name="actions" value="first_aid"> First Aid Applied</label>
              <label class="sf-check"><input type="checkbox" name="actions" value="911"> 911 Called</label>
              <label class="sf-check"><input type="checkbox" name="actions" value="hospital"> Transported to Hospital</label>
              <label class="sf-check"><input type="checkbox" name="actions" value="area_secured"> Area Secured / Isolated</label>
              <label class="sf-check"><input type="checkbox" name="actions" value="wcb_notified"> WCB Notified</label>
              <label class="sf-check"><input type="checkbox" name="actions" value="ohs_notified"> OHS Notified</label>
            </div>
          </div>

          <div class="sf-section">
            <h3>Root Cause Analysis</h3>
            <textarea name="root_cause" rows="3" class="sf-textarea" placeholder="What was the root cause? Contributing factors?"></textarea>
          </div>

          <div class="sf-section">
            <h3>Corrective / Preventive Actions</h3>
            <textarea name="corrective_actions" rows="3" class="sf-textarea" placeholder="What steps will be taken to prevent recurrence?"></textarea>
          </div>

          <div class="sf-section">
            <h3>Witnesses</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Witness 1</label><input type="text" name="witness1" placeholder="Name and contact"></div>
              <div class="sf-field"><label>Witness 2</label><input type="text" name="witness2" placeholder="Name and contact"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Report Completed By</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Supervisor / Foreman</label><input type="text" name="reported_by" required></div>
              <div class="sf-field"><label>Date Reported</label><input type="date" name="reported_date" required></div>
            </div>
          </div>

          <div class="sf-submit-row">
            <div class="sf-email-note">⚠️ This form will be emailed to all registered company contacts immediately.</div>
            <div class="sf-submit-actions">
              <button type="button" class="btn btn-outline" onclick="previewSafetyForm('incident')">👁 Preview</button>
              <button type="submit" class="btn btn-danger">🚨 Submit Incident Report</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Site Inspection Tab -->
      <div id="sf-tab-sf-inspection" class="pm-tab-content safety-form-tab">
        <div class="sf-form-header">
          <div>
            <h2>Site Safety Inspection</h2>
            <p>Weekly site safety walkthrough — document and track hazards</p>
          </div>
          <div class="sf-compliance-badges">
            <span class="sf-badge">✅ OHS Act</span>
          </div>
        </div>
        <form id="form-inspection" class="safety-form" onsubmit="submitSafetyForm(event,'inspection')">
          <div class="sf-section">
            <h3>Inspection Details</h3>
            <div class="sf-grid-2">
              <div class="sf-field"><label>Date</label><input type="date" name="date" required></div>
              <div class="sf-field"><label>Project / Site</label><select name="project_id"><option value="">Select project...</option></select></div>
              <div class="sf-field"><label>Inspected By</label><input type="text" name="inspected_by" required></div>
              <div class="sf-field"><label>Weather Conditions</label><input type="text" name="weather" placeholder="e.g. Clear, -5°C, windy"></div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Inspection Checklist</h3>
            <div class="sf-inspection-table">
              <div class="sf-inspect-header">
                <span>Item</span><span>Pass</span><span>Fail</span><span>N/A</span><span>Notes</span>
              </div>
              <div class="sf-inspect-row">
                <span>Housekeeping — site clean, materials stored safely</span>
                <input type="radio" name="inspect_housekeeping" value="pass">
                <input type="radio" name="inspect_housekeeping" value="fail">
                <input type="radio" name="inspect_housekeeping" value="na">
                <input type="text" name="note_housekeeping" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>PPE — workers wearing required equipment</span>
                <input type="radio" name="inspect_ppe" value="pass">
                <input type="radio" name="inspect_ppe" value="fail">
                <input type="radio" name="inspect_ppe" value="na">
                <input type="text" name="note_ppe" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Fall protection — guardrails, openings covered</span>
                <input type="radio" name="inspect_fall" value="pass">
                <input type="radio" name="inspect_fall" value="fail">
                <input type="radio" name="inspect_fall" value="na">
                <input type="text" name="note_fall" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Electrical — cords protected, panels covered</span>
                <input type="radio" name="inspect_electrical" value="pass">
                <input type="radio" name="inspect_electrical" value="fail">
                <input type="radio" name="inspect_electrical" value="na">
                <input type="text" name="note_electrical" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Tools & equipment — in good condition, guarded</span>
                <input type="radio" name="inspect_tools" value="pass">
                <input type="radio" name="inspect_tools" value="fail">
                <input type="radio" name="inspect_tools" value="na">
                <input type="text" name="note_tools" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Ladders — secured, correct angle, not overloaded</span>
                <input type="radio" name="inspect_ladders" value="pass">
                <input type="radio" name="inspect_ladders" value="fail">
                <input type="radio" name="inspect_ladders" value="na">
                <input type="text" name="note_ladders" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Fire extinguishers — accessible, charged, not blocked</span>
                <input type="radio" name="inspect_fire" value="pass">
                <input type="radio" name="inspect_fire" value="fail">
                <input type="radio" name="inspect_fire" value="na">
                <input type="text" name="note_fire" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>First aid kit — fully stocked, accessible</span>
                <input type="radio" name="inspect_firstaid" value="pass">
                <input type="radio" name="inspect_firstaid" value="fail">
                <input type="radio" name="inspect_firstaid" value="na">
                <input type="text" name="note_firstaid" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Signage — hazard signs posted, site secured from public</span>
                <input type="radio" name="inspect_signage" value="pass">
                <input type="radio" name="inspect_signage" value="fail">
                <input type="radio" name="inspect_signage" value="na">
                <input type="text" name="note_signage" placeholder="Notes">
              </div>
              <div class="sf-inspect-row">
                <span>Emergency procedures — posted, crew aware of muster point</span>
                <input type="radio" name="inspect_emergency" value="pass">
                <input type="radio" name="inspect_emergency" value="fail">
                <input type="radio" name="inspect_emergency" value="na">
                <input type="text" name="note_emergency" placeholder="Notes">
              </div>
            </div>
          </div>

          <div class="sf-section">
            <h3>Deficiencies Found</h3>
            <textarea name="deficiencies" rows="3" class="sf-textarea" placeholder="List all deficiencies found and corrective actions required..."></textarea>
          </div>

          <div class="sf-section">
            <h3>Overall Inspection Rating</h3>
            <div class="sf-rating-row">
              <label class="sf-rating-opt"><input type="radio" name="overall_rating" value="satisfactory"> ✅ Satisfactory</label>
              <label class="sf-rating-opt"><input type="radio" name="overall_rating" value="needs_improvement"> ⚠️ Needs Improvement</label>
              <label class="sf-rating-opt"><input type="radio" name="overall_rating" value="unsatisfactory"> 🔴 Unsatisfactory — Stop Work</label>
            </div>
          </div>

          <div class="sf-submit-row">
            <div class="sf-email-note">📧 Form will be emailed to company contacts and saved to Records.</div>
            <div class="sf-submit-actions">
              <button type="button" class="btn btn-outline" onclick="previewSafetyForm('inspection')">👁 Preview</button>
              <button type="submit" class="btn btn-primary">✅ Submit Inspection</button>
            </div>
          </div>
        </form>
      </div>

      <!-- Records Tab -->
      <div id="sf-tab-sf-records" class="pm-tab-content safety-form-tab">
        <div class="page-header" style="padding:0;margin-bottom:16px">
          <h2 style="margin:0">📂 Safety Form Records</h2>
          <div class="page-actions">
            <select id="sf-records-filter" onchange="renderSafetyRecords()" class="btn btn-outline btn-sm" style="cursor:pointer">
              <option value="all">All Forms</option>
              <option value="flha">FLHA</option>
              <option value="fall">Fall Arrest</option>
              <option value="toolbox">Tool Box Talk</option>
              <option value="incident">Incident Reports</option>
              <option value="inspection">Site Inspections</option>
            </select>
          </div>
        </div>
        <div id="sf-records-list">
          <div class="pm-empty-state">
            <div class="pm-empty-icon">📂</div>
            <h3>No Records Yet</h3>
            <p>Submitted safety forms will appear here. Complete and submit a form from any of the tabs above.</p>
          </div>
        </div>
      </div>

    </div>
'''

# Add to app.html before </div><!-- end main-app -->
marker = '</div><!-- end main-app -->'

with open('web/app.html', 'r') as f:
    content = f.read()

if marker not in content:
    print("ERROR: marker not found!")
else:
    idx = content.rfind(marker)  # find last occurrence
    new_content = content[:idx] + new_pages_html + '\n' + content[idx:]
    with open('web/app.html', 'w') as f:
        f.write(new_content)
    print(f"Done. Added {len(new_pages_html)} chars of new page HTML")
    print(f"New file size: {len(new_content)} chars")