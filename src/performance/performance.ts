import { Injectable, Inject, Optional, NgZone, ApplicationRef } from '@angular/core';
import { Observable } from 'rxjs';
import { filter, tap, take } from 'rxjs/operators';
import { FirebaseOptions, FirebaseAppConfig } from '@angular/fire';
import { FirebaseOptionsToken, FirebaseNameOrConfigToken, _firebaseAppFactory } from '@angular/fire';
import { PerformanceController } from '@firebase/performance/dist/src/controllers/perf';

export type TraceOptions = {
  metrics: {[key:string]: number},
  attributes?:{[key:string]:string},
  attribute$?:{[key:string]:Observable<string>},
  incrementMetric$:{[key:string]: Observable<number|void|null|undefined>},
  metric$?:{[key:string]: Observable<number>}
};

@Injectable()
export class AngularFirePerformance {
  
  performance: PerformanceController;

  constructor(
    @Inject(FirebaseOptionsToken) options:FirebaseOptions,
    @Optional() @Inject(FirebaseNameOrConfigToken) nameOrConfig:string|FirebaseAppConfig|null|undefined,
    appRef: ApplicationRef,
    private zone: NgZone
  ) {
    
    this.performance = zone.runOutsideAngular(() => {
      const app = _firebaseAppFactory(options, nameOrConfig);
      return app.performance();
    });
    
    // TODO detirmine more built in metrics
    appRef.isStable.pipe(
      this.traceComplete('isStable'),
      filter(it => it),
      take(1)
    ).subscribe();

  }

  trace$ = (name:string, options?: TraceOptions) => new Observable<void>(emitter => 
    this.zone.runOutsideAngular(() => {
      const trace = this.performance.trace(name);
      options && options.metrics && Object.keys(options.metrics).forEach(metric => {
        trace.putMetric(metric, options!.metrics![metric])
      });
      options && options.attributes && Object.keys(options.attributes).forEach(attribute => {
        trace.putAttribute(attribute, options!.attributes![attribute])
      });
      const attributeSubscriptions = options && options.attribute$ ? Object.keys(options.attribute$).map(attribute =>
        options!.attribute$![attribute].subscribe(next => trace.putAttribute(attribute, next))
      ) : [];
      const metricSubscriptions = options && options.metric$ ? Object.keys(options.metric$).map(metric =>
        options!.metric$![metric].subscribe(next => trace.putMetric(metric, next))
      ) : [];
      const incrementOnSubscriptions = options && options.incrementMetric$ ? Object.keys(options.incrementMetric$).map(metric =>
        options!.incrementMetric$![metric].subscribe(next => trace.incrementMetric(metric, next || undefined))
      ) : [];
      emitter.next(trace.start());
      return { unsubscribe: () => {
        trace.stop();
        metricSubscriptions.forEach(m => m.unsubscribe());
        incrementOnSubscriptions.forEach(m => m.unsubscribe());
        attributeSubscriptions.forEach(m => m.unsubscribe());
      }};
    })
  );

  traceUntil = <T=any>(name:string, test: (a:T) => boolean, options?: TraceOptions) => (source$: Observable<T>) => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(a => { if (test(a)) { traceSubscription.unsubscribe() }})
    )
  };

  traceComplete = <T=any>(name:string, options?: TraceOptions) => (source$: Observable<T>) => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(
        () => {},
        () => {},
        () => traceSubscription.unsubscribe()
      )
    )
  };

  trace = <T=any>(name:string, options?: TraceOptions) => (source$: Observable<T>) => {
    const traceSubscription = this.trace$(name, options).subscribe();
    return source$.pipe(
      tap(
        () => traceSubscription.unsubscribe(),
        () => {},
        () => traceSubscription.unsubscribe()
      )
    )
  };

}
