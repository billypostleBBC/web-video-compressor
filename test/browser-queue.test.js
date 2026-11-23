const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserQueue } = require('../src/renderer/export-plan.js');
const videos = [{id:'a',name:'a.mp4'},{id:'b',name:'b.mov'}];

test('browser queue completes every MP4 before WebMs and posters across the batch', () => {
  const queue = createBrowserQueue(videos);
  const jobs = [];
  for (let job; (job = queue.takeNext());) {
    jobs.push(job);
    queue.finish(job.id);
  }
  assert.deepEqual(jobs.map(j=>j.exportDefinition.kind), [
    ...Array(6).fill('mp4'), ...Array(6).fill('webm'), 'poster','poster'
  ]);
  assert.equal(new Set(jobs.map(j=>j.id)).size,14);
});

test('skip is reversible while pending but cannot deactivate active or completed work', () => {
  const queue = createBrowserQueue(videos);
  const first = queue.jobs[0];
  assert.equal(queue.setSkipped(first.id,true),true);
  assert.notEqual(queue.takeNext().id,first.id);
  assert.equal(queue.setSkipped(first.id,false),true);
  assert.equal(queue.takeNext().id,first.id);
  assert.equal(queue.setSkipped(first.id,true),false);
  queue.finish(first.id);
  assert.equal(queue.setSkipped(first.id,true),false);
  assert.equal(queue.setSkipped('unknown',true),false);
});

test('initial exclusions are honoured and an entirely skipped queue has no work', () => {
  const original = createBrowserQueue(videos);
  const queue = createBrowserQueue(videos,original.jobs.map(j=>j.id));
  assert.equal(queue.takeNext(),null);
  assert.equal(queue.setSkipped(queue.jobs[0].id,false),true);
  assert.equal(queue.takeNext().id,queue.jobs[0].id);
});
