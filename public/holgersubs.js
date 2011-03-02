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
    }
  });
  var SubtitleSequence = Class.create({
    initialize: function () {
      this._subtitles = [];
      this._undoStack = [];
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
    eachSubtitle: function (start, end, fn) {
      var i = this._subtitleIndexFromTime(start);
      for (; this._subtitles[i] && this._subtitles[i].start < end; i++) {
        var sub = this._subtitles[i];
        fn(sub.start, sub.end, sub.text);
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
    undo: function () {
      var command = this._undoStack.pop();
      this._notifyObservers(command.undo());
    },
    toStl: function () {
      var lines = this._subtitles.map(function (sub) {
        return sub.toStl();
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
    _removeSubtitleAt: function (time) {
      var index = this._subtitleIndexFromTime(time);
      this._subtitles.splice(index, 1);
    },
    _applyCommand: function (command) {
      this._notifyObservers(command.apply());
      this._undoStack.push(command);
    },
    _notifyObservers: function (arg) {
      this._observers.forEach(function (observer) {
        observer.notify(arg);
      });
    },
  });

  SubtitleSequence.fromStl = function (text) {
    var seq = new SubtitleSequence();

    var lines = text.split("\n");

    lines.forEach(function (line) {
      var parts = line.split(" , ");
      if (parts.length >= 3) {
        var start = smpteToFrames(parts[0]);
        var end = smpteToFrames(parts[1]);
        var text = parts.slice(2).join(" , ");
      }

      seq.addSubtitle(start, end, text);
    });

    return seq;
  };

  var FPS = 50;

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

  var Editor = Class.create({
    initialize: function (idPrefix) {
      this._idPrefix = idPrefix;
      this._subs = null;
      this._updateInterval = null;
      this._editorLines = [];
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

      this._getElement("add").on("click", this._addSubtitle.bind(this));
    },
    setupVideoSources: function () {
      var that = this;
      var videoUrls = argumentsToArray(arguments);

      var oldSourceTags = this._videoElement.getElementsByTagName("source");
      for (var i = 0; i < oldSourceTags.length; i++) {
        this._videoElement.removeChild(oldSourceTags[i]);
      }

      videoUrls.forEach(function (url) {
        var sourceElement = document.createElement("source");
        sourceElement.setAttribute("src", url);
        that._videoElement.appendChild(sourceElement);
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
      this._updateDirtySpan();
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
      var html = text.replace("\\n", "<br>");
      this._subDisplayElement.innerHTML = html;
    },
    _getCurrentFrame: function () {
      return secondsToFrames(this._videoElement.currentTime);
    },
    _addSubtitle: function () {
      this._subs.addSubtitle(this._getCurrentFrame(),
                             this._getCurrentFrame() + 10,
                             "Foo @ " + this._getCurrentFrame());
      this._updateDirtySpan();
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
    _updateDirtySpan: function () {
      var lineRemovalStartIndex = this._getEditorLineIndexAfterFrame(this._dirtySpanStart);
      var lineRemovalEndIndex = this._getEditorLineIndexAfterFrame(this._dirtySpanEnd);
      var lineBeforeRemovalSpan = this._editorLines[lineRemovalStartIndex - 1];
      var lineAfterRemovalSpan = this._editorLines[lineRemovalEndIndex];
      var linesToRemove = lineRemovalEndIndex - lineRemovalStartIndex;
      var removedLines = this._editorLines.splice(lineRemovalStartIndex, linesToRemove);
      var that = this;
      removedLines.forEach(function (editorLine) {
        that._subtitlesElement.removeChild(editorLine.getDomElement());
      });
      debug("_dirtySpanStart: " + this._dirtySpanStart);
      debug("lineRemovalStartIndex: " + lineRemovalStartIndex);
      debug("linesToRemove: " + linesToRemove);
      debug("removedLines: " + removedLines);
      console.dir(this);

      if (lineAfterRemovalSpan === undefined) {
        this._addNewEditorLinesThroughFunction(function (element) {
          that._subtitlesElement.appendChild(element);
        }, lineRemovalStartIndex);
      } else {
        this._addNewEditorLinesThroughFunction(function (element) {
          lineAfterRemovalSpan.getDomElement().insert({ before: element });
        }, lineRemovalStartIndex);
      }

      this._clearDirtySpan();
    },
    _getEditorLineIndexAfterFrame: function (frame) {
      for (var i = 0;; i++) {
        var editorLine = this._editorLines[i];
        if (editorLine === undefined || editorLine.getFrame() > frame) {
          return i;
        }
      }
    },
    _addNewEditorLinesThroughFunction: function (addFunction, atIndex) {
      var that = this;
      var lastEnd = null;
      var index = atIndex;
      this._subs.eachSubtitle(
        this._dirtySpanStart,
        this._dirtySpanEnd,
        function (start, end, text) {
          var textLine = that._newEditorLine(start, text, atIndex++);
          addFunction(textLine.createDomElement());
          if (lastEnd !== null && lastEnd < start) {
            var noTextLine = that._newEditorLine(end, "", atIndex++);
            addFunction(noTextLine.createDomElement());
          }
          lastEnd = end;
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
    var editorBuilder = {
      withVideo: function (url) {
        editor.setupVideoSources(url);
        return this;
      },
      withVideos: function () {
        editor.setupVideoSources.apply(editor, arguments);
        return this;
      },
      withSubs: function (url) {
        editor.requestAndLoadSubs(url);
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
    },
    getFrame: function () {
      return this._frame;
    },
    getDomElement: function () {
      return this._topElement;
    },
    createDomElement: function () {
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
      this._textArea.textContent = this._text.replace("\\n", "\n");
      this._topElement.insert(this._textArea);

      return this._topElement;
    },
    _getDisplayText: function () {
      if (this._text === "") {
        return "&mdash;";
      } else {
        return this._text.replace("\\n", "<br>");
      }
    },
    _createPlayButton: function () {
      var element = new Element("button", { type: "button", title: "Spela härifrån" }).update("&#x25b6;");
      return element;
    },
    _createBackButton: function () {
      return this._createButton("-", "Flytta en bildruta bakåt");
    },
    _createForwardButton: function () {
      return this._createButton("+", "Flytta en bildruta framåt");
    },
    _createMoveToPlayCursorButton: function (parentNode) {
      return this._createButton("&#x2195;", "Flytta en bildruta framåt");
    },
    _createButton: function (contents, title) {
      var holder = new Element("div", { "class": "HS_buttonholder" });
      var element = new Element("button", { type: "button", style: "display:none", title: title }).update(contents);
      holder.insert(element);
      return holder;
    },

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

  return { SubtitleSequence: SubtitleSequence,
           smpteToFrames: smpteToFrames,
           framesToSMPTE: framesToSMPTE,
           makeEditorWithIdPrefix: makeEditorWithIdPrefix };
})();