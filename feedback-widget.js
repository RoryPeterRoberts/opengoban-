// Feedback FAB + Modal widget
// Include on any page after supabase.js. Call initFeedbackWidget(memberId) once the member is loaded.

(function () {
  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    .feedback-fab { position: fixed; bottom: var(--space-4); right: var(--space-4); display: flex; align-items: center; gap: var(--space-2); background: var(--color-primary); color: white; padding: var(--space-3) var(--space-4); border-radius: var(--radius-full); border: none; cursor: pointer; box-shadow: var(--shadow-lg); z-index: 1000; font-family: var(--font-family); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); transition: all var(--transition-fast); }
    .feedback-fab:hover { background: var(--color-primary-dark); transform: translateY(-2px); }
    .feedback-fab svg { width: 18px; height: 18px; }
    .feedback-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-bottom: var(--space-4); }
    .feedback-type-option { display: flex; flex-direction: column; align-items: center; padding: var(--space-4); background: var(--color-bg-warm); border: 2px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; transition: all var(--transition-fast); }
    .feedback-type-option:hover { border-color: var(--color-secondary); }
    .feedback-type-option.selected { border-color: var(--color-primary); background: var(--color-primary-bg); }
    .feedback-type-option input { position: absolute; opacity: 0; pointer-events: none; }
    .feedback-type-emoji { font-size: 1.5rem; margin-bottom: var(--space-2); }
    .feedback-type-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text); }
  `;
  document.head.appendChild(style);

  // Inject HTML
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="modal-overlay" id="feedback-modal">
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">Send Feedback</h2>
          <p class="modal-subtitle">Help us improve Open Gobán.</p>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">What type of feedback?</label>
            <div class="feedback-type-grid" id="feedback-type-grid">
              <label class="feedback-type-option selected" data-type="idea"><input type="radio" name="feedback-type" value="idea" checked><span class="feedback-type-emoji">💡</span><span class="feedback-type-label">Idea</span></label>
              <label class="feedback-type-option" data-type="bug"><input type="radio" name="feedback-type" value="bug"><span class="feedback-type-emoji">🐛</span><span class="feedback-type-label">Bug</span></label>
              <label class="feedback-type-option" data-type="question"><input type="radio" name="feedback-type" value="question"><span class="feedback-type-emoji">❓</span><span class="feedback-type-label">Question</span></label>
              <label class="feedback-type-option" data-type="other"><input type="radio" name="feedback-type" value="other"><span class="feedback-type-emoji">💬</span><span class="feedback-type-label">Other</span></label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Your message</label>
            <textarea class="textarea" id="feedback-message" placeholder="Tell us what's on your mind..." rows="4"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="closeFeedbackModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitFeedbackForm()">Send</button>
        </div>
      </div>
    </div>
    <button class="feedback-fab" onclick="openFeedbackModal()" style="display:none;" id="feedback-fab">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Feedback
    </button>
  `;
  while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);

  // State
  let _feedbackMemberId = null;
  let _selectedType = 'idea';

  // Type selection
  document.querySelectorAll('#feedback-modal .feedback-type-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('#feedback-modal .feedback-type-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      option.querySelector('input').checked = true;
      _selectedType = option.dataset.type;
    });
  });

  // Public API
  window.initFeedbackWidget = function (memberId) {
    _feedbackMemberId = memberId;
    document.getElementById('feedback-fab').style.display = 'flex';
  };

  window.openFeedbackModal = function () {
    document.getElementById('feedback-modal').classList.add('active');
    document.getElementById('feedback-fab').style.display = 'none';
    document.getElementById('feedback-message').focus();
  };

  window.closeFeedbackModal = function () {
    document.getElementById('feedback-modal').classList.remove('active');
    document.getElementById('feedback-fab').style.display = 'flex';
    document.getElementById('feedback-message').value = '';
    _selectedType = 'idea';
    document.querySelectorAll('#feedback-modal .feedback-type-option').forEach(opt => {
      opt.classList.remove('selected');
      if (opt.dataset.type === 'idea') { opt.classList.add('selected'); opt.querySelector('input').checked = true; }
    });
  };

  window.submitFeedbackForm = function () {
    const message = document.getElementById('feedback-message').value.trim();
    if (!message) { if (typeof showToast === 'function') showToast('Please enter your feedback'); return; }

    createFeedbackRecord({
      author_id: _feedbackMemberId,
      type: _selectedType,
      message: message
    }).then(() => {
      closeFeedbackModal();
      if (typeof showToast === 'function') showToast('Thank you! Your feedback has been submitted.');
    }).catch(e => {
      console.error('Feedback error:', e);
      if (typeof showToast === 'function') showToast('Failed to submit feedback. Please try again.');
    });
  };
})();
