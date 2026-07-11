/*
 * Avro Phonetic engine -- web port (UI chunk: controller)
 * The state machine that replaces ibus's job: watches keystrokes in a
 * field, keeps a raw Latin buffer for the word currently being typed
 * (since Bangla text can't be un-transliterated back to Latin), asks
 * the SuggestionBuilder for a live preview + candidate list, and
 * rewrites the field's text as the user types.
 */

var Avro = (typeof Avro !== 'undefined') ? Avro : {};
Avro.UI = Avro.UI || {};

Avro.UI.Controller = function (field) {
    this.field = field;                          // Avro.UI.FieldAdapter
    this.suggestionBuilder = new Avro.SuggestionBuilder();
    this.window = new Avro.UI.CandidateWindow();
    this.window.onSelect(this._onCandidatePicked.bind(this));

    this._reset();
};

Avro.UI.Controller.prototype = {

    _reset: function () {
        this._active = false;      // is a word currently being composed?
        this._rawBuffer = '';      // raw Latin typed so far, e.g. "bangla"
        this._wordStart = 0;       // index into field value where word begins
        this._previewLen = 0;      // length of the currently-inserted preview text
        this._suggestion = null;   // last suggest() result
    },

    // ---- key handling ----
    // Returns true if the event was consumed (caller should preventDefault).
    handleKeyDown: function (e) {
        if (this._matchesKey(e, Avro.Config.toggleKey)) {
            Avro.UI.toggle();
            return true;
        }

        if (!Avro.UI.isEnabled()) return false;

        if (this.window.isVisible()) {
            if (e.key === 'ArrowDown') { this.window.moveSelection(1); return true; }
            if (e.key === 'ArrowUp') { this.window.moveSelection(-1); return true; }
            if (Avro.Config.digitSelect && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
                var picked = this.window.selectIndex(parseInt(e.key, 10) - 1);
                if (picked !== undefined && picked !== null) {
                    this._applyCandidate(picked);
                    return true;
                }
            }
        }

        if (e.key === Avro.Config.cancelKey && this._active) {
            this._cancel();
            return true;
        }

        if (Avro.Config.commitKeys.indexOf(e.key) !== -1 && this._active) {
            // Commit current preview (or highlighted candidate), then let the
            // key's own default behavior happen (e.g. actually insert the space).
            if (this.window.isVisible()) {
                this._applyCandidate(this.window.getSelected());
            } else {
                this._commit();
            }
            return false;
        }

        if (e.key === 'Backspace' && this._active && Avro.Config.smartBackspace) {
            this._backspace();
            return true;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (Avro.Config.wordCharRegex.test(e.key)) {
                this._appendChar(e.key);
                return true;
            } else if (this._active) {
                // Non-word character (punctuation etc.) ends the word.
                this._commit();
                return false;
            }
        }

        return false;
    },

    _matchesKey: function (e, spec) {
        return e.key === spec.key &&
            !!e.ctrlKey === !!spec.ctrlKey &&
            !!e.altKey === !!spec.altKey &&
            !!e.shiftKey === !!spec.shiftKey;
    },

    // ---- word composition ----

    _appendChar: function (ch) {
        if (!this._active) {
            this._active = true;
            this._rawBuffer = '';
            this._wordStart = this.field.getCaretIndex();
            this._previewLen = 0;
        }
        this._rawBuffer += ch;
        this._reparse();
    },

    _backspace: function () {
        if (this._rawBuffer.length <= 1) {
            // Removing the last source character: drop the whole preview
            // and let the field go back to empty for this word.
            this.field.replaceRange(this._wordStart, this._wordStart + this._previewLen, '');
            this._reset();
            this.window.hide();
            return;
        }
        this._rawBuffer = this._rawBuffer.slice(0, -1);
        this._reparse();
    },

    _reparse: function () {
        var suggestion = this.suggestionBuilder.suggest(this._rawBuffer);
        this._suggestion = suggestion;

        // words[0] is already the engine's best pick: autocorrect exact match,
        // else top dictionary suggestion, else classic phonetic fallback --
        // same priority ibus-avro's own lookup table uses for the preedit.
        var words = (suggestion.words && suggestion.words.length) ? suggestion.words : [this._rawBuffer];
        var preview = words[0];

        this.field.replaceRange(this._wordStart, this._wordStart + this._previewLen, preview);
        this._previewLen = preview.length;

        var rect = this.field.getCaretRect();
        this.window.show(words, rect);
    },

    _applyCandidate: function (word) {
        if (word === undefined || word === null) { this._commit(); return; }
        this.field.replaceRange(this._wordStart, this._wordStart + this._previewLen, word);
        this._previewLen = word.length;
        this.suggestionBuilder.updateCandidateSelection(this._rawBuffer, word);
        this._commit();
    },

    _onCandidatePicked: function (word) {
        this._applyCandidate(word);
    },

    _commit: function () {
        if (this._suggestion && this._suggestion.words) {
            var finalWord = this.field.getValue().substr(this._wordStart, this._previewLen);
            this.suggestionBuilder.stringCommitted(this._rawBuffer, finalWord);
        }
        this._reset();
        this.window.hide();
    },

    _cancel: function () {
        // Revert to the raw Latin text the user actually typed.
        this.field.replaceRange(this._wordStart, this._wordStart + this._previewLen, this._rawBuffer);
        this._reset();
        this.window.hide();
    }
};
