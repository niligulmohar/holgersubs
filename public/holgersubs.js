HS = (function () {
  var Subtitle = Class.create({
    initialize: function (start, end, text) {
      this.start = start;
      this.end = end;
      this.text = text;
    },
    toStl: function () {
      return [framesToSMPTE(this.start),
              framesToSMPTE(this.end),
              this.text].join(" , ");
    },
    toString: function () {
      return "[Subtitle " + framesToSMPTE(this.start) + "-" + framesToSMPTE(this.end) + " " + this.text + "]";
    }
  });
  var SubtitleSequence = Class.create({
    initialize: function () {
      this._subtitles = [];
      this._undoStack = [];
      this._redoStack = [];
      this._observers = [];
    },
    subtitleAt: function (time) {
      var index = this._subtitleIndexFromTime(time);
      var sub = this._subtitles[index];
      if (sub && sub.start <= time) {
        return sub;
      } else {
        return undefined;
      }
    },
    subtitleAtOrAfter: function (time) {
      var index = this._subtitleIndexFromTime(time);
      var sub = this._subtitles[index];
      return sub;
    },
    eachSubtitle: function (start, end, fn) {
      var i = this._subtitleIndexFromTime(start);
      for (; this._subtitles[i] && this._subtitles[i].start < end; i++) {
        var sub = this._subtitles[i];
        var nextSub = this._subtitles[i + 1];
        var nextStart;

        if (nextSub === undefined) {
          nextStart = null;
        } else {
          nextStart = nextSub.start;
        }
        fn(sub.start, sub.end, sub.text, nextStart);
      }
    },
    addSubtitle: function (start, end, text) {
      var sub = new Subtitle(start, end, text);
      var that = this;
      var command = {
        apply: function () {
          return that._insertSubtitle(sub);
        },
        undo: function () {
          return that._removeSubtitleAt(start);
        }
      };
      this._applyCommand(command);
    },
    removeStartOfSubtitleAt: function (time, options) {
      var oldSubtitle = this.subtitleAt(time);
      var that = this;
      var removedSubtitle;
      var command = {
        apply: function () {
          return that._removeSubtitleAt(time, options);
        },
        undo: function () {
          return that._insertSubtitle(oldSubtitle);
        }
      };
      this._applyCommand(command);
    },
    removeEndOfSubtitleAt: function (time) {
      var index = this._subtitleIndexFromTime(time);
      var oldSubtitle = this._subtitles[index];
      var nextSubtitle = this._subtitles[index + 1];
      var end;
      if (nextSubtitle === undefined) {
        end = LAST_FRAME;
      } else {
        end = nextSubtitle.start;
      }
      var newSubtitle = new Subtitle(oldSubtitle.start, end, oldSubtitle.text);
      var that = this;
      var command = {
        apply: function () {
          return that._replaceSubtitleAtIndex(index, newSubtitle);
        },
        undo: function () {
          return that._replaceSubtitleAtIndex(index, oldSubtitle);
        }
      };
      this._applyCommand(command);
    },
    changeSubtitleTextAtTimeTo: function (time, text) {
      if (text === "") {
        if (this.subtitleAt(time) !== undefined) {
          this.removeStartOfSubtitleAt(time, { preservePrecedingSubtitleEnd: true });
        }
      } else {
        var index = this._subtitleIndexFromTime(time);
        var oldSubtitle = this._subtitles[index];
        var newSubtitle;
        var that = this;
        var command;
        if (oldSubtitle && oldSubtitle.start <= time) {
          newSubtitle = new Subtitle(oldSubtitle.start, oldSubtitle.end, text);
          command = {
            apply: function () {
              return that._replaceSubtitleAtIndex(index, newSubtitle);
            },
            undo: function () {
              return that._replaceSubtitleAtIndex(index, oldSubtitle);
            }
          };
        } else {
          var nextSubtitle = oldSubtitle;
          var endTime = (nextSubtitle ? nextSubtitle.start : Infinity);
          newSubtitle = new Subtitle(time, endTime, text);
          command = {
            apply: function () {
              return that._insertSubtitle(newSubtitle);
            },
            undo: function () {
              return that._removeSubtitleAt(time, { preservePrecedingSubtitleEnd: true });
            }
          };
        }
        this._applyCommand(command);
      }
    },
    loadFromStl: function (text) {
      var seq = new SubtitleSequence();
      var lines = text.split("\n");
      lines.forEach(function (line) {
        if (line !== "") {
          var parts = line.split(" , ");
          if (parts.length >= 3) {
            var start = smpteToFrames(parts[0]);
            var end = smpteToFrames(parts[1]);
            var text = parts.slice(2).join(" , ");
          }
          if (!isEmpty(text)) {
            seq.addSubtitle(start, end, text);
          }
        }
      });

      var oldSubtitles = this._subtitles;
      var newSubtitles = seq._subtitles;
      var that = this;
      var command = {
        apply: function () {
          that._subtitles = newSubtitles;
          return { start: 0, end: Infinity };
        },
        undo: function () {
          that._subtitles = oldSubtitles;
          return { start: 0, end: Infinity };
        }
      }
      this._applyCommand(command);
    },
    undoAvailable: function () {
      return this._undoStack.length > 0;
    },
    undo: function (args) {
      var command = this._undoStack.pop();
      if (!(args && args.withoutRedo)) {
        this._redoStack.push(command);
      }
      this._notifyObservers(command.undo());
    },
    clearUndoStack: function () {
      this._undoStack = [];
    },
    compoundLastTwoCommands: function () {
      if (this._undoStack.length >= 2) {
        var newerCommand = this._undoStack.pop();
        var olderCommand = this._undoStack.pop();
        var compoundCommand = {
          apply: function () {
            var interval0 = olderCommand.apply();
            var interval1 = newerCommand.apply();
            return intervalUnion(interval0, interval1);
          },
          undo: function () {
            var interval0 = newerCommand.undo();
            var interval1 = olderCommand.undo();
            return intervalUnion(interval0, interval1);
          }
        }
        this._undoStack.push(compoundCommand);
      } else {
        throw new Error("There are less than two commands on the undo stack");
      }
    },
    redoAvailable: function () {
      return this._redoStack.length > 0;
    },
    redo: function () {
      var command = this._redoStack.pop();
      this._undoStack.push(command);
      this._notifyObservers(command.apply());
    },
    toStl: function () {
      var lines = [];
      this._subtitles.forEach(function (sub) {
        if (!isEmpty(sub.text)) {
          lines.push(sub.toStl());
        }
      });
      return lines.join("\n") + "\n";
    },
    registerObserver: function (observer) {
      this._observers.push(observer);
    },
    _subtitleIndexFromTime: function (time) {
      return this._subtitleBinarySearch(time, 0, this._subtitles.length);
    },
    _subtitleBinarySearch: function (time, startIndex, endIndex) {
      if (startIndex === endIndex) {
        return startIndex;
      }
      var middle = startIndex + Math.floor((endIndex - startIndex) / 2);
      if (time < this._subtitles[middle].end) {
        return this._subtitleBinarySearch(time, startIndex, middle);
      }
      else {
        return this._subtitleBinarySearch(time, middle + 1, endIndex);
      }
    },
    _insertSubtitle: function (newSub) {
      var index = this._subtitleIndexFromTime(newSub.start);
      var subAtIndex = this._subtitles[index];
      if (subAtIndex && subAtIndex.start < newSub.start) {
        index ++;
      }
      var nextSub = this._subtitles[index];
      var prevSub = this._subtitles[index - 1];

      if (nextSub) {
        if (nextSub.start === newSub.start) {
          throw new Error("Subtitles may not start simultaneously");
        }
        if (nextSub.start < newSub.end) {
          newSub.end = nextSub.start;
        }
      };

      if (prevSub && prevSub.end > newSub.start) {
        prevSub.end = newSub.start;
      }

      this._subtitles.splice(index, 0, newSub);
      return { start: newSub.start,
               end: newSub.end };
    },
    _removeSubtitleAt: function (time, options) {
      try {
        var index = this._subtitleIndexFromTime(time);
        var oldSub = this._subtitles[index];
        var prevSub = this._subtitles[index - 1];
        options = options || {};
        this._subtitles.splice(index, 1);
        if (prevSub && prevSub.end === oldSub.start) {
          if (! options.preservePrecedingSubtitleEnd) {
            prevSub.end = oldSub.end;
          }
          return { start: prevSub.start,
                   end: oldSub.end };
        } else {
          return { start: oldSub.start,
                   end: oldSub.end };
        }
      } catch (error) {
        console.log(error);
        console.log(error.stack);
        throw error;
      }
    },
    _replaceSubtitleAtIndex: function (index, newSub) {
      var oldSub = this._subtitles[index];
      this._subtitles.splice(index, 1, newSub);

      return { start: oldSub.start,
               end: Math.max(oldSub.end, newSub.end) };
    },
    _applyCommand: function (command) {
      this._notifyObservers(command.apply());
      this._undoStack.push(command);
      this._redoStack = [];
    },
    _notifyObservers: function (arg) {
      this._observers.forEach(function (observer) {
        observer.notify(arg);
      });
    },
    toString: function () {
      var subtitles = this._subtitles.join("\n                  ");
      return "[SubtitleSequence " + subtitles + "]";
    }
  });

  SubtitleSequence.fromStl = function (text) {
    var seq = new SubtitleSequence();
    seq.loadFromStl(text);
    seq.clearUndoStack();
    return seq;
  };

  var intervalUnion = function (interval0, interval1) {
    var start = Math.min(interval0.start, interval1.start);
    var end = Math.max(interval0.end, interval1.end);
    return { start: start, end: end };
  }

  var FPS = 50;

  var LAST_FRAME = FPS * (99 * 3600 + 59 * 60 + 59 + 1) - 1;

  var smpteToFrames = function (smpte) {
    var seconds = 0;
    var parts = smpte.split(":");
    seconds += parts[0] * 3600;
    seconds += parts[1] * 60;
    seconds += (+parts[2]);
    var frames = seconds * FPS;
    frames += (+parts[3]);
    return frames;
  };

  var framesToSMPTE = function (frames) {
    var h = leadingZero(Math.floor(frames / (3600 * FPS)));
    var m = leadingZero(Math.floor((frames % (3600 * FPS)) / (60 * FPS)));
    var s = leadingZero(Math.floor(frames % (60 * FPS) / FPS));
    var f = leadingZero(Math.floor(frames % FPS));
    return h + ":" + m + ":" + s + ":" + f;
  };

  var leadingZero = function (number) {
    var result = "";
    if (number < 10) {
      result += "0";
    }
    result += number.toFixed(0);
    return result;
  };

  var secondsToFrames = function (seconds) {
    return Math.round(seconds * FPS);
  };

  var framesToSeconds = function (frames) {
    return frames / FPS;
  };

  var isEmpty = function (text) {
    return (/^\s*$/).test(text);
  };

  var Editor = Class.create({
    initialize: function (idPrefix) {
      this._idPrefix = idPrefix;
      this._updateInterval = null;
      this._subs = null;
      this._editorLines = [];
      this._selectedEditorLine = null;
      this._storageId = null;
      this._temporaryPause = false;
      this._addedTemporarySubtitle = false;
      window.$E = this;
    },
    setup: function () {
      this._videoElement = this._getElement("video");
      this._setupVideoEventListeners();
      this._subDisplayElement = this._getElement("subdisplay");
      this._timeElement = this._getElement("time");
      this._statusElement = this._getElement("status");
      this._subtitlesElement = this._getElement("subtitles");
      this._editTimeElement = this._getElement("edit-time");
      this._editTextElement = this._getElement("edit-text");

      var that = this;
      this._getElement("add").on("click", function (event) {
        Event.stop(event);
        that._addSubtitle();
      });
      this._removeButton = this._getElement("remove");
      this._showStlButton = this._getElement("show-stl");
      this._undoButton = this._getElement("undo");
      this._redoButton = this._getElement("redo");
      this._showGuiButton = this._getElement("show-gui");

      this._guiContainer = this._getElement("gui-container");
      this._statusTextSpan = this._getElement("status-text");
      this._stlContainer = this._getElement("stl-container");
      this._stlTextArea = this._getElement("stl");

      this._addKeyHandlers();
      this._addClickHandlers();
      this._setupHelp();
      this.loadStlData("");
    },
    _addKeyHandlers: function () {
      var that = this;
      $(document).on("keydown", function (event) {
        if (Event.findElement(event, "textarea")) {
          return;
        }
        var code = event.keyCode;
        if (code === 32) {
          /* Space */
          that.togglePlayOrPause();
          Event.stop(event);
        } else if (code === 13) {
          /* Return */
          if (that._selectedEditorLine) {
            that.editLine(that._selectedEditorLine);
          }
          Event.stop(event);
        } else if (code === 27) {
          /* Escape */
          if (that._isHelpVisible()) {
            that._hideHelp();
          } else if (that._selectedEditorLine) {
            that.editLine(that._selectedEditorLine);
          }
          Event.stop(event);
        } else if (code === 74 || (code === 78 && event.ctrlKey) || code === 40) {
          /* "J", Ctrl-N or */
          that._selectNextLine();
        } else if (code === 75 || (code === 80 && event.ctrlKey) || code === 38) {
          /* "K", Ctrl-P or */
          that._selectPreviousLine();
        } else if (code === 90 && (event.ctrlKey || event.metaKey)) {
          /* Ctrl-Z or Command-Z */
          that.undo();
          Event.stop(event);
        } else if (code === 89 && (event.ctrlKey || event.metaKey)) {
          /* Ctrl-Y or Command-Y */
          that._redo();
          Event.stop(event);
        } else if (code === 73 || code === 107 || (code === 78 && event.metaKey && event.altKey)) {
          /* "I", "+" or Command-N */
          that._addSubtitle();
          Event.stop(event);
        } else if (code === 68 || code === 109 || code === 46 || code === 8) {
          /* "D", "-", Delete or Backspace */
          that._removeSubtitle();
          Event.stop(event);
        } else if (code === 37) {
          /* Left */
          that._seekSeconds(-5);
        } else if (code === 39) {
          /* Right */
          that._seekSeconds(5);
        } else if (code === 80) {
          /* P */
          if (that._selectedEditorLine) {
            that.startPlayingFromTime(that._selectedEditorLine.getFrame());
          }
        } else if (code === 191) {
          /* ? */
          that._toggleHelp();
        } else {
          console.log("keyCode", code);
        }
      });
    },
    _addClickHandlers: function () {
      this._showGuiButton.on("click", this._showGui.bind(this));
      this._redoButton.on("click", this._redo.bind(this));
      this._undoButton.on("click", this.undo.bind(this));
      this._showStlButton.on("click", this._showStl.bind(this));
      this._removeButton.on("click", this._removeSubtitle.bind(this));
      var that = this;
      $(document).on("click", function (event) {
        if (Event.isLeftClick(event)) {
          if (!Event.findElement(event, "textarea")) {
            that.leaveEditMode();
          }
        }
      });
    },
    _setupHelp: function () {
      this._helpContainer = this._getElement("help");
      this._helpButton = this._getElement("show-help");
      this._helpButton.on("click", this._toggleHelp.bind(this));
      this._helpKeyTable = this._getElement("help-keys");
      this._helpCloseLink = this._getElement("help-close");
      var that = this;
      this._helpCloseLink.on("click", function (event) {
        that._hideHelp();
      });
      this._addKeyHelp("<Mellanslag>", "Spela/pausa film")
      this._addKeyHelp(["<Vänsterpil>", "/", "<Högerpil>"], "Hoppa 5 sekunder framåt/bakåt");
      this._addKeyHelp(["<Uppil>", "eller", "k"], "Välj föregående text");
      this._addKeyHelp(["<Nedpil>", "eller", "j"], "Välj nästa text");
      this._addKeyHelp("<Enter>", "Ändra text");
      this._addKeyHelp(this._ctrlOrCmdKeyName("z"), "Ångra");
      this._addKeyHelp(this._ctrlOrCmdKeyName("y"), "Upprepa");
      this._addKeyHelp("i", "Lägg till text vid aktuell position i filmen");
      this._addKeyHelp("d", "Radera vald text");
      this._addKeyHelp("p", "Spela filmen från vald text");
      this._addKeyHelp("?", "Öppna hjälpen för kortkommandon");
    },
    _toggleHelp: function () {
      this._helpContainer.toggle();
    },
    _isHelpVisible: function () {
      return this._helpContainer.visible();
    },
    _hideHelp: function () {
      this._helpContainer.hide();
    },
    _addKeyHelp: function (key, description) {
      var tr = createElement("tr");
      var keyTd = createElement("td", { "class": this._idPrefix + "key",
                                        parent: tr });

      if (typeof key === "string") {
        key = [key];
      }
      for (var i = 0, l = key.length; i < l; i++) {
        var keyText = key[i];
        if (i % 2 === 0) {
          createElement("span", { "class": this._idPrefix + "key",
                                  parent: keyTd,
                                  text: keyText });
        } else {
          keyTd.appendChild(document.createTextNode(" " + keyText + " "));
        }
      }
      keyTd.appendChild(document.createTextNode(" :"));
      var descriptionTd = createElement("td", { parent: tr,
                                                text: description });
      this._helpKeyTable.appendChild(tr);
    },
    _ctrlOrCmdKeyName: function (key) {
      var ctrlOrCmd = (navigator.platform === "MacIntel" ? "<Cmd>" : "<Ctrl>");
      return [ctrlOrCmd, "+", key];
    },
    setStorageId: function (id) {
      this._storageId = id;
    },
    setupVideoSources: function () {
      var that = this;
      var videoUrls = argumentsToArray(arguments);

      var oldSourceTags = this._videoElement.getElementsByTagName("source");
      for (var i = 0; i < oldSourceTags.length; i++) {
        this._videoElement.removeChild(oldSourceTags[i]);
      }

      videoUrls.forEach(function (url) {
        createElement("source", { src: url,
                                  parent: that._videoElement });
      });
    },
    requestAndLoadSubs: function (url) {
      new Ajax.Request(url, {
        onSuccess: withErrorLogging(function (response) {
          this.loadStlData(response.responseText);
        }.bind(this))
      });
    },
    loadStlData: function (stlData) {
      this._subs = SubtitleSequence.fromStl(stlData);
      this._extendDirtySpanCompletely();
      this._setupSubtitleSequenceObserver();
      this._updateEditorState();
    },
    _showStl: function () {
      this._guiContainer.hide();
      this._stlContainer.show();
      var stl = this._subs.toStl();
      this._oldStlCode = stl;
      this._stlTextArea.value = stl;
      this._stlTextArea.activate();
    },
    _showGui: function () {
      this._stlContainer.hide();
      this._guiContainer.show();
      var stl = this._stlTextArea.value;
      if (stl !== this._oldStlCode) {
        this._subs.loadFromStl(stl);
        this._updateEditorState();
      }
    },
    save: function () {
      this._saveSubsToLocalStorage();
    },
    _saveSubsToLocalStorage: function () {
      localStorage.setItem(this._getStorageKey(), this._subs.toStl());
    },
    _getSubsInLocalStorage: function () {
      return localStorage.getItem(this._getStorageKey());
    },
    _getStorageKey: function () {
      return "stlForId" + this._storageId;
    },
    hasSubsInLocalStorage: function () {
      return !!this._getSubsInLocalStorage();
    },
    loadSubsFromLocalStorage: function () {
      this.loadStlData(this._getSubsInLocalStorage());
    },
    message: function (text) {
      this._statusTextSpan.textContent = text;
    },
    togglePlayOrPause: function () {
      if (this._videoElement.paused) {
        this._playVideo();
      } else {
        this._pauseVideo();
      }
    },
    enterTemporaryPause: function () {
      if (!this._videoElement.paused) {
        this._temporaryPause = true;
        this._pauseVideo();
      }
    },
    leaveTemporaryPause: function () {
      if (this._temporaryPause) {
        this._temporaryPause = false;
        this._playVideo();
      }
    },
    _seekSeconds: function (seconds) {
      this._videoElement.currentTime += seconds;
    },
    _selectNextLine: function () {
      var index = this._editorLines.indexOf(this._selectedEditorLine);
      var newLine = this._editorLines[index + 1];
      if (newLine) {
        this.selectEditorLine(newLine);
      }
    },
    _selectPreviousLine: function () {
      var index = this._editorLines.indexOf(this._selectedEditorLine);
      var newLine = this._editorLines[index - 1];
      if (newLine) {
        this.selectEditorLine(newLine);
      }
    },
    selectEditorLine: function (line) {
      var oldLine = this._selectedEditorLine;
      if (line === oldLine) {
        return;
      }
      this._selectedEditorLine = line;

      if (oldLine !== null) {
        oldLine.deselect();
      }
      line.select();

      this._updateRemoveButton();
    },

    editLine: function (line) {
      this.selectEditorLine(line);
      line.enterEditMode();
    },

    leaveEditMode: function (line) {
      this.save();
      var oldLine = this._selectedEditorLine;
      if (oldLine) {
        oldLine.leaveEditMode();
      }
    },

    textChangedOnLine: function (line) {
      console.log("textChangedOnLine");
      this._subs.changeSubtitleTextAtTimeTo(line.getFrame(), line.getText());
      if (this._addedTemporarySubtitle) {
        this._subs.compoundLastTwoCommands();
        console.log("compounding commands");
        if (isEmpty(line.getText) &&
            this._addedTemporarySubtitle !== "movedPreviousSubtitleEnd") {
          this._subs.undo({ withoutRedo: true });
          console.log("undoing temporary line addition");
        }
        this._addedTemporarySubtitle = false;
      }
      this._updateEditorState();
    },

    startPlayingFromTime: function (time) {
      var that = this;
      this._videoElement.currentTime = framesToSeconds(time);
      this._playVideo();
    },

    moveSubtitleAtTimeToCurrentFrame: function (time) {
      console.log(this._getEditorLineAt(time));
    },

    _getElement: function (idWithoutPrefix) {
      return $(this._idPrefix + idWithoutPrefix);
    },
    _setupVideoEventListeners: function () {
      this._addVideoEventListener("play", this._onVideoPlay);
      this._addVideoEventListener("pause", this._onVideoStop);
      this._addVideoEventListener("ended", this._onVideoStop);
      this._addVideoEventListener("seeked", this._onVideoSeek);
      this._addVideoEventListener("canplay", this._updateSubtitleDisplay);
    },
    _pauseVideo: function () {
      this._videoElement.pause();
    },
    _playVideo: function () {
      this._videoElement.play();
    },
    _addVideoEventListener: function (name, callback) {
      this._videoElement.addEventListener(name, callback.bind(this), true);
    },
    _onVideoPlay: function () {
      var callback = this._onVideoTimeChanged.bind(this);
      this._updateInterval = setInterval(callback, 20);
    },
    _onVideoStop: function () {
      if (this._updateInterval !== null) {
        clearInterval(this._updateInterval);
        this._updateInterval = null;
      }
    },
    _onVideoSeek: function () {
      this._onVideoTimeChanged();
    },
    _onVideoTimeChanged: function () {
      this._updateSubtitleDisplay();
    },
    _updateSubtitleDisplay: function () {
      if (this._subs !== null) {
        var sub = this._getSubtitleAtVideoTime();
        if (sub === undefined) {
          this._setSubtitleDisplayText("");
        } else {
          this._setSubtitleDisplayText(sub.text);
        }
      }
    },
    _getSubtitleAtVideoTime: function () {
      return this._subs.subtitleAt(this._getCurrentFrame());
    },
    _setSubtitleDisplayText: function (text) {
      var html = text.replace("\\n", "<br>").replace("|", "<br>");
      this._subDisplayElement.innerHTML = html;
    },
    _getCurrentFrame: function () {
      return secondsToFrames(this._videoElement.currentTime);
    },
    _getLastFrame: function () {
      return secondsToFrames(this._videoElement.duration);
    },
    undo: function () {
      this.leaveEditMode();
      if (this._subs.undoAvailable()) {
        this._subs.undo();
        this._updateEditorState();
      }
    },
    _selectEditorLineAtTime: function (time) {
      var editorLine = this._getEditorLineAt(time);
      if (editorLine) {
        this.selectEditorLine(editorLine);
      }
    },
    _editLineAt: function (time) {
      var editorLine = this._getEditorLineAt(time);
      if (editorLine) {
        this.editLine(editorLine);
      }
    },
    _getEditorLineAt: function (time) {
      var lineIndex = this._getEditorLineIndexBeforeFrame(time);
      if (lineIndex < 0) {
        lineIndex = 0;
      }
      return this._editorLines[lineIndex];
    },
    _redo: function () {
      if (this._subs.redoAvailable()) {
        this._subs.redo();
        this._updateEditorState();
      }
    },
    _addSubtitle: function () {
      this.enterTemporaryPause();
      var now = this._getCurrentFrame();
      console.log("now", now);
      var referenceSubtitle = this._subs.subtitleAtOrAfter(now);
      console.log("referenceSubtitle", referenceSubtitle);
      var withinSubtitle = referenceSubtitle && (referenceSubtitle.start <= now);
      console.log("withinSubtitle", withinSubtitle);
      var start = now;
      if (referenceSubtitle === undefined) {
        this._subs.addSubtitle(now, LAST_FRAME, "");
        this._addedTemporarySubtitle = true;
      } else if (referenceSubtitle.start < now) {
        this._subs.addSubtitle(now, referenceSubtitle.end, "");
        this._addedTemporarySubtitle = "movedPreviousSubtitleEnd";
      } else if (referenceSubtitle.start === now) {
        this._editLineAt(now);
        return;
      } else {
        this._subs.addSubtitle(now, referenceSubtitle.start, "");
        this._addedTemporarySubtitle = true;
      }
      this._updateEditorState();
      this._editLineAt(now);
    },
    _removeSubtitle: function () {
      if (this._selectedEditorLine) {
        if (this._selectedEditorLine.isEmpty()) {
          this._subs.removeEndOfSubtitleAt(this._selectedEditorLine.getFrame() - 1);
        } else {
          this._subs.removeStartOfSubtitleAt(this._selectedEditorLine.getFrame());
        }
        this._updateEditorState();
      }
    },
    _extendDirtySpanCompletely: function () {
      this._dirtySpanStart = 0;
      this._dirtySpanEnd = Infinity;
    },
    _setupSubtitleSequenceObserver: function () {
      var that = this;
      this._subs.registerObserver({
        notify: function (arg) {
          that._extendDirtySpan(arg.start, arg.end);
        }
      });
    },
    _extendDirtySpan: function (start, end) {
      this._dirtySpanStart = Math.min(this._dirtySpanStart, start);
      this._dirtySpanEnd = Math.max(this._dirtySpanEnd, end);
    },
    _updateEditorState: function () {
      this.save();
      var firstFrameOfChanges = this._dirtySpanStart;
      var now = this._getCurrentFrame();
      if (now >= this._dirtySpanStart && now <= this._dirtySpanEnd) {
        this._updateSubtitleDisplay();
      }

      if (this._subs.undoAvailable()) {
        this._undoButton.enable();
      } else {
        this._undoButton.disable();
      }

      if (this._subs.redoAvailable()) {
        this._redoButton.enable();
      } else {
        this._redoButton.disable();
      }

      this._updateDirtySpan();

      this._updateRemoveButton();
      this._selectEditorLineAtTime(firstFrameOfChanges);
    },
    _updateRemoveButton: function () {
      if (this._selectedEditorLine !== null) {
        this._removeButton.enable();
      } else {
        this._removeButton.disable();
      }
    },
    _updateDirtySpan: function () {
      console.log("updating dirty span", this._dirtySpanStart, this._dirtySpanEnd);
      var lineRemovalStartIndex = this._getEditorLineIndexAfterFrame(this._dirtySpanStart);
      console.log("line removal start index", lineRemovalStartIndex);
      console.log("which is", ""+this._editorLines[lineRemovalStartIndex]);
      var lineRemovalEndIndex = this._getEditorLineIndexAfterFrame(this._dirtySpanEnd);
      console.log("line removal end index pre", lineRemovalEndIndex);
      lineRemovalEndIndex = Math.max(lineRemovalStartIndex, lineRemovalEndIndex);
      console.log("line removal end index", lineRemovalEndIndex);
      console.log("which is", ""+this._editorLines[lineRemovalEndIndex]);
      var lineBeforeRemovalSpan = this._editorLines[lineRemovalStartIndex - 1];
      var lineAfterRemovalSpan = this._editorLines[lineRemovalEndIndex];
      console.log("line after removal span", ""+lineAfterRemovalSpan);
      if (lineAfterRemovalSpan && lineAfterRemovalSpan.isEmpty()) {
        lineRemovalEndIndex ++;
        lineAfterRemovalSpan = this._editorLines[lineRemovalEndIndex];
        console.log("line removal end index modified", lineRemovalEndIndex);
      }
      var linesToRemove = lineRemovalEndIndex - lineRemovalStartIndex;
      console.log("lines to remove", linesToRemove);
      var removedLines = this._editorLines.splice(lineRemovalStartIndex, linesToRemove);
      var that = this;
      removedLines.forEach(function (editorLine) {
        that._subtitlesElement.removeChild(editorLine.getDomElement());
      });

      if (lineAfterRemovalSpan === undefined) {
        this._addNewEditorLinesThroughFunction(function (element) {
          that._subtitlesElement.appendChild(element);
        }, lineRemovalStartIndex, lineAfterRemovalSpan);
      } else {
        this._addNewEditorLinesThroughFunction(function (element) {
          lineAfterRemovalSpan.getDomElement().insert({ before: element });
        }, lineRemovalStartIndex, lineAfterRemovalSpan);
      }

      this._clearDirtySpan();
    },
    _getEditorLineIndexAfterFrame: function (frame) {
      for (var i = 0;; i++) {
        var editorLine = this._editorLines[i];
        if (editorLine === undefined || editorLine.getFrame() >= frame) {
          return i;
        }
      }
    },
    _getEditorLineIndexBeforeFrame: function (frame) {
      for (var i = this._editorLines.length - 1;; i--) {
        var editorLine = this._editorLines[i];
        if (editorLine === undefined || editorLine.getFrame() <= frame) {
          return i;
        }
      }
    },
    _addNewEditorLinesThroughFunction: function (addFunction, atIndex, beforeEditorLine) {
      var that = this;
      var index = atIndex;
      this._subs.eachSubtitle(
        this._dirtySpanStart,
        this._dirtySpanEnd,
        function (start, end, text, nextStart) {
          //console.log("Adding subtitle", text);
          var textLine = that._newEditorLine(start, text, atIndex++);
          addFunction(textLine.createDomElement());
          if (end > start &&
              (nextStart === null || end < nextStart) &&
              end < LAST_FRAME &&
              (beforeEditorLine === undefined || end < beforeEditorLine.getFrame())) {
            var noTextLine = that._newEditorLine(end, "", atIndex++);
            //console.log("Adding empty subtitle");
            addFunction(noTextLine.createDomElement());
          }
        }
      );
    },
    _newEditorLine: function (time, text, atIndex) {
      var editorLine = new EditorLine(this, time, text);
      this._editorLines.splice(atIndex, 0, editorLine);
      return editorLine;
    },
    _clearDirtySpan: function () {
      this._dirtySpanStart = Infinity;
      this._dirtySpanEnd = -Infinity;
    }
  });

  var makeEditorWithIdPrefix = function (idPrefix) {
    var editor = new Editor(idPrefix);
    editor.setup();
    var loadedSubsFromLocalStorage = false;
    var editorBuilder = {
      withStorageId: function (id) {
        editor.setStorageId(id);
        if (editor.hasSubsInLocalStorage()) {
          editor.loadSubsFromLocalStorage();
          loadedSubsFromLocalStorage = true;
        }
        return this;
      },
      withVideo: function (url) {
        editor.setupVideoSources(url);
        return this;
      },
      withVideos: function () {
        editor.setupVideoSources.apply(editor, arguments);
        return this;
      },
      withSubs: function (url) {
        if (!loadedSubsFromLocalStorage) {
          editor.requestAndLoadSubs(url);
        }
        return this;
      }
    }
    return editorBuilder;
  };

  var EditorLine = Class.create({
    initialize: function (editor, frame, text) {
      this._editor = editor;
      this._frame = frame;
      this._text = text;
      this._editMode = false;
    },
    getFrame: function () {
      return this._frame;
    },
    getText: function () {
      return this._text;
    },
    getDomElement: function () {
      return this._topElement;
    },
    isInEditMode: function () {
      return this._editMode;
    },
    createDomElement: function () {
      var that = this;
      this._topElement = new Element("div", { "class": "HS_listitem" });
      this._timeElement = new Element("div", { "class": "HS_time" });
      this._playButton = this._createPlayButton();
      this._timeElement.insert(this._playButton);
      this._backButton = this._createBackButton();
      this._timeElement.insert(this._backButton);
      this._timeText = new Element("span").update(framesToSMPTE(this._frame));
      this._timeElement.insert(this._timeText);
      this._forwardButton = this._createForwardButton();
      this._timeElement.insert(this._forwardButton);
      this._moveButton = this._createMoveToPlayCursorButton();
      this._timeElement.insert(this._moveButton);
      this._topElement.insert(this._timeElement);
      this._textContainer = new Element("div", { "class": "HS_listtext" });
      this._textElement = new Element("span").update(this._getDisplayText());
      this._textContainer.insert(this._textElement);
      this._topElement.insert(this._textContainer);
      this._textArea = new Element("textarea", { rows: 2, cols: 40, style: "display:none" });
      this._textArea.textContent = this._getEditText();
      this._textArea.on("keydown", function (event) {
        var isEscape = (event.keyCode === 27);
        var isReturn = (event.keyCode === 13 && !event.shiftKey);
        if (isEscape || isReturn) {
          that.leaveEditMode();
          Event.stop(event);
        }
      });
      this._topElement.insert(this._textArea);

      this._topElement.on("click", function () {
        this._editor.selectEditorLine(this);
      }.bind(this));
      this._textElement.on("click", function (e) {
        Event.stop(e);
        this._editor.editLine(this);
      }.bind(this));

      return this._topElement;
    },
    select: function () {
      this._topElement.addClassName("HS_selected");
      var topElement = this._topElement;
      var offsetParent = topElement.offsetParent;
      if (topElement.offsetTop < offsetParent.scrollTop) {
        offsetParent.scrollTop = topElement.offsetTop;
      }
      if (topElement.offsetTop + topElement.offsetHeight > offsetParent.scrollTop + offsetParent.offsetHeight - 4) {
        offsetParent.scrollTop = topElement.offsetTop - offsetParent.offsetHeight + topElement.offsetHeight + 4;
      }
      this._showButtons();
    },
    deselect: function () {
      this._topElement.removeClassName("HS_selected");
      this.leaveEditMode();
      this._hideButtons();
    },
    _showButtons: function () {
      //this._moveButton.firstChild.show();
    },
    _hideButtons: function () {
      //this._moveButton.firstChild.hide();
    },
    isEmpty: function () {
      return isEmpty(this._text);
    },
    enterEditMode: function () {
      if (!this._editMode) {
        this._editMode = true;
        this._textElement.hide();
        this._textArea.show();
        this._textArea.activate();
      }
    },
    leaveEditMode: function () {
      if (this._editMode) {
        this._editMode = false;
        this._textArea.hide();
        this._textArea.blur();
        var newText = this._editTextToInternalText(this._textArea.value);
        if (newText === "" || newText !== this._text) {
          this._text = newText;
          console.log("updating text");
          this._textElement.innerHTML = this._getDisplayText();
          this._editor.textChangedOnLine(this);
        }
        this._textElement.show();
        this._editor.leaveTemporaryPause();
      }
    },
    _getDisplayText: function () {
      if (this.isEmpty()) {
        return "&mdash;";
      } else {
        return this._text.replace("\\n", "<br>");
      }
    },
    _getEditText: function () {
      if (this.isEmpty()) {
        return "";
      } else {
        return this._text.replace("\\n", "\n");
      }
    },
    _editTextToInternalText: function (text) {
      if (isEmpty(text)) {
        return "";
      } else {
        return text.replace("\n", "\\n");
      }
    },
    _createPlayButton: function () {
      var element = new Element("button", { type: "button", title: "Spela härifrån (P)" }).update("&#x25b6;");
      var that = this;
      element.on("click", function (event) {
        Event.stop(event);
        that._editor.startPlayingFromTime(that._frame);
      });
      return element;
    },
    _createBackButton: function () {
      var button = this._createButton("-", "Flytta en bildruta bakåt");
      return button.holder;
    },
    _createForwardButton: function () {
      var button = this._createButton("+", "Flytta en bildruta framåt");
      return button.holder;
    },
    _createMoveToPlayCursorButton: function () {
      var button = this._createButton("&#x2195;", "Flytta till aktuell position");
      var that = this;
      button.element.on("click", function (event) {
        Event.stop(event);
        that._editor.moveSubtitleAtTimeToCurrentFrame(that._frame);
      });
      return button.holder;
    },
    _createButton: function (contents, title) {
      var holder = new Element("div", { "class": "HS_buttonholder" });
      var element = new Element("button", { type: "button", style: "display:none", title: title }).update(contents);
      holder.insert(element);
      return { holder: holder, element: element };
    },
    toString: function () {
      return "[EditorLine " + framesToSMPTE(this._frame) + " " + this._text + "]";
    }
  });

  var argumentsToArray = function (argObject) {
    return [].slice.call(argObject, 0);
  };

  var withErrorLogging = function (fn) {
    return function () {
      try {
        fn.apply(this, arguments);
      } catch (e) {
        logError(e)
        throw e;
      }
    };
  };

  var logError = function (error) {
    if (typeof console !== "undefined") {
      if (console.error) {
        console.error(error);
      }
      if (console.dir) {
        console.dir(error);
      }
    }
  };

  var debug = function (text) {
    if (typeof console !== "undefined" && console.debug) {
      console.debug(text);
    }
  };

  var createElement = function (tagName, attributes) {
    var result = document.createElement(tagName);
    if (attributes) {
      for (var name in attributes) {
        var value = attributes[name];
        if (name === "parent") {
          value.appendChild(result);
        } else if (name === "text") {
          result.textContent = value;
        } else {
          result.setAttribute(name, value);
        }
      }
    }
    return result;
  };

  return { SubtitleSequence: SubtitleSequence,
           smpteToFrames: smpteToFrames,
           framesToSMPTE: framesToSMPTE,
           makeEditorWithIdPrefix: makeEditorWithIdPrefix };
})();