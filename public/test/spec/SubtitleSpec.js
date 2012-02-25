describe("SMPTE utilities", function () {
  describe("the SMPTE timestamp parser", function () {
    it("should count frames correctly", function () {
      expect(HS.smpteToFrames("00:00:00:01")).toBe(1);
    });
    it("should count seconds correctly", function () {
      expect(HS.smpteToFrames("00:00:01:00")).toBe(50);
    });
    it("should count minutes correctly", function () {
      expect(HS.smpteToFrames("00:01:00:00")).toBe(50 * 60);
    });
    it("should count hours correctly", function () {
      expect(HS.smpteToFrames("01:00:00:00")).toBe(50 * 3600);
    });
  });
  describe("the SMPTE timestamp formatter", function () {
    it("should output frames correctly", function () {
      expect(HS.framesToSMPTE(1)).toBe("00:00:00:01");
    });
    it("should output seconds correctly", function () {
      expect(HS.framesToSMPTE(50)).toBe("00:00:01:00");
    });
    it("should output minutes correctly", function () {
      expect(HS.framesToSMPTE(50 * 60)).toBe("00:01:00:00");
    });
    it("should output hours correctly", function () {
      expect(HS.framesToSMPTE(50 * 3600)).toBe("01:00:00:00");
    });
  });
});

describe("SubtitleSequence", function () {
  var seq;

  beforeEach(function () {
    seq = new HS.SubtitleSequence();
  });
  describe("adding a subtitle", function () {
    var START = 10;
    var MIDDLE = 15;
    var END = 20;
    beforeEach(function () {
      seq.addSubtitle(START, END, "Subtitle");
    });
    describe("the added subtitle", function () {
      it("should be found when searching at its start time", function () {
        var sub = seq.subtitleAt(START);
        expect(sub).toBeDefined();
      });
      it("should be found when searching in its duration", function () {
        var sub = seq.subtitleAt(MIDDLE);
        expect(sub).toBeDefined();
      });
      it("should not be found when searching at its end time", function () {
        var sub = seq.subtitleAt(END);
        expect(sub).not.toBeDefined();
      });
      it("should not be found when searching before its start", function () {
        var sub = seq.subtitleAt(START - 1);
        expect(sub).not.toBeDefined();
      });
      it("should be found when using subtitleAtOrAfter before its beginning", function () {
        var sub = seq.subtitleAtOrAfter(START - 1);
        expect(sub).toBeDefined();
      });
    });
    describe("adding another subtitle, out of order", function () {
      var ANOTHER_START = 0;
      var ANOTHER_END = 10;
      beforeEach(function () {
        seq.addSubtitle(ANOTHER_START, ANOTHER_END, "The other one");
      });
      describe("the other added subtitle", function () {
        it("should be found when searching at its start time", function () {
          var sub = seq.subtitleAt(ANOTHER_START);
          expect(sub).toBeDefined();
          expect(sub.text).toBe("The other one");
        });
      });
      it("should be undoable", function () {
        seq.undo();
        var another_sub = seq.subtitleAt(ANOTHER_START);
        expect(sub).not.toBeDefined();

        var sub = seq.subtitleAt(START);
        expect(sub).toBeDefined();
      });
    });
    describe("after adding, undo", function () {
      it("should be available", function () {
        expect(seq.undoAvailable()).toBe(true);
      });
      it("should work", function () {
        seq.undo();
        var sub = seq.subtitleAt(START);
        expect(sub).not.toBeDefined();
      });
      it("should send a correct notification", function () {
        var observer = {
          notify: jasmine.createSpy()
        };
        seq.registerObserver(observer);
        seq.undo();

        expect(observer.notify).toHaveBeenCalledWith({ start: START, end: END });
      });
      describe("after undoing, redo", function () {
        beforeEach(function () {
          seq.undo();
        });
        it("should be available", function () {
          expect(seq.redoAvailable()).toBe(true);
        });
        it("should work", function () {
          seq.redo();
          var sub = seq.subtitleAt(START);
          expect(sub).toBeDefined();
        });
        it("should send a correct notification", function () {
          var observer = {
            notify: jasmine.createSpy()
          };
          seq.registerObserver(observer);
          seq.redo();

          expect(observer.notify).toHaveBeenCalledWith({ start: START, end: END });
        });
      });
      describe("after undoing, adding a subtitle", function () {
        beforeEach(function () {
          seq.undo();
          seq.addSubtitle(START, END, "Subtitle");
        });
        it("should disable redo", function () {
          expect(seq.redoAvailable()).toBe(false);
        });
      });
    });
  });
  describe("adding subtitles starting simultaneously", function () {
    it("should throw an exception", function () {
      seq.addSubtitle(1, 2, "Hej");
      expect(function () {
        seq.addSubtitle(1, 2, "Hopp");
      }).toThrow("Subtitles may not start simultaneously");
    });
  });
  describe("adding overlapping subtitles", function () {
    describe("adding one before another", function () {
      it("should move the end of the earlier one back", function () {
        seq.addSubtitle(10, 20, "Later sub");
        seq.addSubtitle(5, 15, "Earlier sub");
        var earlierSub = seq.subtitleAt(5);
        expect(earlierSub.text).toEqual("Earlier sub");
        expect(earlierSub.end).toEqual(10);
      });
    });
    describe("adding one after another", function () {
      it("should also move the end of the earlier one back", function () {
        seq.addSubtitle(5, 15, "Earlier sub");
        seq.addSubtitle(10, 20, "Later sub");
        var earlierSub = seq.subtitleAt(5);
        expect(earlierSub.text).toEqual("Earlier sub");
        expect(earlierSub.end).toEqual(10);
      });
    });
  });
  describe("removing the end of a subtitle", function () {
    beforeEach(function () {
      seq.addSubtitle(5, 10, "Earlier sub");
      seq.addSubtitle(15, 20, "Later sub");
    });
    it("should extend the duration of the subtitle to the start of the next one", function () {
      seq.removeEndOfSubtitleAt(5);
      var earlierSub = seq.subtitleAt(5);
      expect(earlierSub.end).toEqual(15);
    });
    describe("removing the end of the last subtitle", function () {
      it("should throw an exception", function () {
        expect(function () {
          seq.removeEndOfSubtitleAt(15);
        }).toThrow("Cannot remove the end of the last subtitle");
      });
    });
  });
  describe("removing the beginning of a subtitle", function () {
    beforeEach(function () {
      seq.addSubtitle(5, 10, "Earlier sub");
      seq.addSubtitle(15, 20, "Later sub");
    });
    describe("removing the beginning of the first subtitle", function () {
      it("should remove the subtitle", function () {
        seq.removeStartOfSubtitleAt(5);
        var earlierSub = seq.subtitleAt(5);
        expect(earlierSub).not.toBeDefined();
      });
    });
    describe("removing the beginning of a subtitle preceded by another one", function () {
      describe("the previous subtitle ends before the one being removed starts", function () {
        it("should remove the subtitle", function () {
          seq.removeStartOfSubtitleAt(15);
          var laterSub = seq.subtitleAt(15);
          expect(laterSub).not.toBeDefined();
        });
      });
      describe("the previous subtitle ends right when the one being removed starts", function () {
        beforeEach(function () {
          seq = new HS.SubtitleSequence();
          seq.addSubtitle(5, 15, "Earlier sub");
          seq.addSubtitle(15, 20, "Later sub");
        });
        it("should merge the timespan of the one being removed into the previous one", function () {
          seq.removeStartOfSubtitleAt(15);
          var remainingSub = seq.subtitleAt(5);
          expect(remainingSub.start).toEqual(5);
          expect(remainingSub.end).toEqual(20);
          expect(remainingSub.text).toEqual("Earlier sub");
        });
      });
    });
    it("should be undoable", function () {
      seq.removeStartOfSubtitleAt(15);
      expect(seq.subtitleAt(15)).not.toBeDefined();
      seq.undo();
      expect(seq.subtitleAt(15)).toBeDefined();
    });
  });
  describe("changing the text of a subtitle", function () {
    beforeEach(function () {
      seq.addSubtitle(5, 15, "Original text");
    });
    it("should work", function () {
      seq.changeSubtitleTextAtTimeTo(5, "New text");
      var sub = seq.subtitleAt(5);
      expect(sub.text).toEqual("New text");
    });
    it("should be undoable", function () {
      seq.changeSubtitleTextAtTimeTo(5, "New text");
      seq.undo();
      var sub = seq.subtitleAt(5);
      expect(sub.text).toEqual("Original text");
    });
    describe("adding text to a subtitle end", function () {
      it("should create a new subtitle", function () {
        seq.changeSubtitleTextAtTimeTo(15, "Additional text");
        var sub = seq.subtitleAt(15);
        expect(sub.text).toEqual("Additional text");
      });
      it("should be undoable", function () {
        seq.changeSubtitleTextAtTimeTo(15, "Additional text");
        seq.undo();
        var sub = seq.subtitleAt(15);
        expect(sub).not.toBeDefined();
      });
      describe("with a following subtitle", function () {
        beforeEach(function () {
          seq.addSubtitle(25, 30, "Following text");
        });
        it("should create a new subtitle", function () {
          seq.changeSubtitleTextAtTimeTo(15, "Additional text");
          var sub = seq.subtitleAt(15);
          expect(sub.text).toEqual("Additional text");
        });
        it("should be undoable", function () {
          seq.changeSubtitleTextAtTimeTo(15, "Additional text");
          seq.undo();
          var sub = seq.subtitleAt(15);
          expect(sub).not.toBeDefined();
          var followingSub = seq.subtitleAt(25);
          expect(followingSub.text).toEqual("Following text");
        });
      });
    });
    describe("clearing a subtitle text", function () {
      it("should remove the subtitle", function () {
        seq.changeSubtitleTextAtTimeTo(5, "");
        var sub = seq.subtitleAt(5);
        expect(sub).not.toBeDefined();
      });
      describe("right after another subtitle", function () {
        beforeEach(function () {
          seq.addSubtitle(0, 5, "Preceding text");
        });
        it("should not set the endpoint of the preceding one", function () {
          seq.changeSubtitleTextAtTimeTo(5, "");
          var sub = seq.subtitleAt(14);
          expect(sub).not.toBeDefined();
        });
      });
      describe("before another subtitle", function () {
        beforeEach(function () {
          seq.addSubtitle(25, 30, "Following text");
        });
        it("should not change the start of the following one", function () {
          seq.changeSubtitleTextAtTimeTo(5, "");
          var sub = seq.subtitleAt(25);
          expect(sub.text).toEqual("Following text");
          expect(sub.start).toEqual(25);
        });
      });
    });
  });
  describe("the observer interface", function () {
    var observer;
    beforeEach(function () {
      observer = {
        notify: jasmine.createSpy()
      };
    });
    it("should allow registration of notification callbacks", function () {
      seq.registerObserver(observer);
    });
    describe("the notification callback interface", function () {
      beforeEach(function () {
        seq.registerObserver(observer);
      });
      it("should be used to report altered timespans", function () {
        seq.addSubtitle(5, 10, "Text");
        expect(observer.notify).toHaveBeenCalledWith({ start: 5, end: 10 });
      });
    });
  });
  describe("iterating over the sequence", function () {
    var spy;
    beforeEach(function () {
      seq.addSubtitle(0, 5, "A");
      seq.addSubtitle(10, 15, "B");
      seq.addSubtitle(20, 25, "C");

      spy = jasmine.createSpy();
    });
    it("should be possible over all subtitles", function () {
      seq.eachSubtitle(0, 30, function (start, end, text, nextStart) {
        spy(text, nextStart);
      });
      expect(spy).toHaveBeenCalledWith("A", 10);
      expect(spy).toHaveBeenCalledWith("B", 20);
      expect(spy).toHaveBeenCalledWith("C", null);
    });
    it("should be possible over parts of the subtitles", function () {
      seq.eachSubtitle(9, 16, function (start, end, text, nextStart) {
        spy(text, nextStart);
      });
      expect(spy).toHaveBeenCalledWith("B", 20);
    });
  });
});

describe("parsing example STL data", function () {
  var seq;
  beforeEach(function () {
    var stlData =
      "00:00:07:10 , 00:00:11:11 , Jag vet hur raggning ska gå till\n" +
      "00:00:11:11 , 00:00:15:15 , Med en flirt , får jag det som jag vill"
    seq = HS.SubtitleSequence.fromStl(stlData);
  });
  it("should not create any subtitle at the first frame", function () {
    expect(seq.subtitleAt(0)).not.toBeDefined();
  });
  it("should create the first subtitle at 07:10", function () {
    var frame = HS.smpteToFrames("00:00:07:10");
    var sub = seq.subtitleAt(frame);
    expect(sub).toBeDefined();
    expect(sub.text).toBe("Jag vet hur raggning ska gå till");
  });
  it("should create the complete second subtitle at 11:11", function () {
    var frame = HS.smpteToFrames("00:00:11:11");
    var sub = seq.subtitleAt(frame);
    expect(sub).toBeDefined();
    expect(sub.text).toBe("Med en flirt , får jag det som jag vill");
  });
  it("should end the second subtitle before 15:15", function () {
    var frame = HS.smpteToFrames("00:00:15:15");
    expect(seq.subtitleAt(frame)).not.toBeDefined();
  });
  it("should not create an extra undefined subtitle for a trailing newline", function () {
    var spy = jasmine.createSpy();

    stlData =
      "00:05:34:09 , 00:05:39:12 , Och det är jag!\n";
    seq = HS.SubtitleSequence.fromStl(stlData);

    seq.eachSubtitle(0, Infinity, function (start, end, text, nextStart) {
      spy(nextStart);
    });
    expect(spy.callCount).toBe(1);
    expect(spy).not.toHaveBeenCalledWith(undefined);
  });
  it("should not be undoable", function () {
    expect(seq.undoAvailable()).toBe(false);
  });
});

describe("the STL formatter", function () {
  it("should output the expected STL data", function () {
    var seq = new HS.SubtitleSequence();
    seq.addSubtitle(HS.smpteToFrames("00:00:15:15"),
                    HS.smpteToFrames("00:00:20:08"),
                    "För en kväll, en madamoiselle, en bagatell");
    var stl = seq.toStl();

    expect(stl).toBe("00:00:15:15 , 00:00:20:08 , För en kväll, en madamoiselle, en bagatell\n");
  });
});