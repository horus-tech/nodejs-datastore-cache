import * as datastore from '@google-cloud/datastore';
import { classToClass, classToPlain, Exclude, plainToClass } from 'class-transformer';

import { DataUtils, DataClient, Entity, GeoPt, Key, Persist, PersistKey, PersistStruct } from '../src';

describe('DataModels', () => {
    describe('Key features', () => {
        let clt: DataClient;
        beforeAll(() => {
            clt = new DataClient();
        });

        afterAll(async () => {
            await expect(clt.close()).resolves.toEqual(undefined);
        });

        it('should wrap datastore keys consistently', () => {
            const k1 = clt.datastoreClient.key(['MyEntity', 'foo']);
            const mk1 = Key.nameKey('MyEntity', 'foo');
            expect(mk1.toDatastore()).toEqual(k1);
            expect(mk1.path).toEqual(k1.path);
            expect(mk1.encode(clt.datastoreClient)).toEqual(clt.datastoreClient.keyToLegacyUrlSafe(k1));

            const k2 = clt.datastoreClient.key(['MyParentEntity', 'foobar', 'MyEntity', 'bar']);
            const mk2 = Key.nameKey('MyEntity', 'bar', undefined, Key.nameKey('MyParentEntity', 'foobar'));
            expect(mk2.toDatastore()).toEqual(k2);
            expect(mk2.path).toEqual(k2.path);
            expect(mk2.encode(clt.datastoreClient)).toEqual(clt.datastoreClient.keyToLegacyUrlSafe(k2));

            const mk3 = Key.fromDatastore(k2);
            expect(mk3.toDatastore()).toEqual(k2);

            const k4 = clt.datastoreClient.key(['MyParentEntity', 1234, 'MyEntity', 5678]);
            const mk4 = Key.idKey('MyEntity', 5678, undefined, Key.idKey('MyParentEntity', 1234));
            expect(mk4.toDatastore()).toEqual(k4);
            expect(mk4.path).toEqual(k4.path);
            expect(mk4.encode(clt.datastoreClient)).toEqual(clt.datastoreClient.keyToLegacyUrlSafe(k4));

            const mk5 = Key.fromDatastore(k4);
            expect(mk5.toDatastore()).toEqual(k4);
        });

        it('should be able to wrap datastore keys to and from datastore calls', async () => {
            const key = Key.incompleteKey('MyEntity', undefined, Key.nameKey('MyParentEntity', '369258147'));
            const dsKey = key.toDatastore();
            await clt.datastoreClient.save({ key: dsKey, data: { 'name': 'foobar' } });
            expect(parseInt(dsKey.id || '0')).toBeGreaterThan(0);

            const recoverKey = Key.fromDatastore(dsKey);
            const [e] = await clt.datastoreClient.get(recoverKey.toDatastore());
            expect(parseInt(e[clt.datastoreClient.KEY].id || '0')).toEqual(parseInt(dsKey.id || '0'));

            const fromStoredKey = Key.fromDatastore(e[clt.datastoreClient.KEY]);
            expect(fromStoredKey.toDatastore()).toEqual(recoverKey.toDatastore());
        });

        it('should serialize and deserialize consistently', () => {
            const k1 = Key.nameKey('MyEntity', 'foo');
            const k2 = Key.nameKey('MyEntity', 'foo', undefined, Key.nameKey('MyParentEntity', 'foo-parent'));
            const k3 = Key.nameKey('MyEntity', 'foo', 'subspace', Key.nameKey('MyParentEntity', 'foo-parent', 'subspace'));

            const plain1 = k1.toPlain();
            expect(Key.fromPlain(plain1).toDatastore()).toStrictEqual(k1.toDatastore());
            const plain2 = k2.toPlain();
            expect(Key.fromPlain(plain2).toDatastore()).toStrictEqual(k2.toDatastore());
            const plain3 = k3.toPlain();
            expect(Key.fromPlain(plain3).toDatastore()).toStrictEqual(k3.toDatastore());
        });
    });

    describe('Entity features', () => {
        let clt: DataClient;
        beforeAll(() => {
            clt = new DataClient();
        });

        afterAll(async () => {
            await expect(clt.close()).resolves.toEqual(undefined);
        });

        it('should serialize and deserialize simple entities consistently', async () => {
            @Exclude()
            class MyEntity extends Entity {
                @Persist()
                text?: string;

                @Persist()
                number?: number;

                @PersistKey()
                child_key?: Key;

                constructor(props?: Partial<MyEntity>) {
                    super(props && props.key);
                    Object.assign(this, props);
                }
            }

            const e1 = new MyEntity({
                key: Key.idKey('MyEntity', 1234),
                text: 'bonjour',
                number: 5678,
                child_key: Key.nameKey('MyChildEntity', '1234-child'),
            });

            // Verify entity is ready to be saved into datastore
            const e1ToDs = e1.toDatastore();
            expect(e1ToDs).toEqual({
                'key': new datastore.Key({ path: ['MyEntity', 1234] }),
                'data': {
                    'text': 'bonjour',
                    'number': 5678,
                    'child_key': new datastore.Key({ path: ['MyChildEntity', '1234-child'] }),
                },
                'excludeFromIndexes': [],
            });

            // Verify entity cannot be restored until saved into datastore
            expect(() => {
                MyEntity.fromDatastore(e1ToDs, MyEntity);
            }).toThrow(Error);

            // Save entity into datastore
            await clt.datastoreClient.save(e1ToDs);

            // Verify entity from datastore can be restored into model
            const [e1RawDs] = await clt.datastoreClient.get(e1ToDs.key);
            const e1FromDs = MyEntity.fromDatastore(e1RawDs, MyEntity);
            expect(JSON.stringify(DataUtils.sortJSON(classToClass(e1FromDs)))).toEqual(JSON.stringify(DataUtils.sortJSON(classToClass(e1))));

            // Verify entity is ready to be saved into cache as JSON
            const e1ToPlain = await e1.toPlain(clt.datastoreClient);

            expect(e1ToPlain).toEqual({
                'key': await e1.key?.encode(clt.datastoreClient),
                'text': 'bonjour',
                'number': 5678,
                'child_key': await e1.child_key?.encode(clt.datastoreClient),
            });

            // Verity entity from plain matches the original entity
            const e1FromPlain = MyEntity.fromPlain(e1ToPlain, MyEntity);
            expect(JSON.stringify(e1FromPlain)).toEqual(JSON.stringify(e1));

            // Class transformer direct use shoul also output consisten results
            const e1FromDirectPlain = plainToClass(MyEntity, classToPlain(e1));
            expect(JSON.stringify(DataUtils.sortJSON(classToClass(e1FromDirectPlain)))).toEqual(JSON.stringify(DataUtils.sortJSON(classToClass(e1))));
            await expect(clt.get(e1FromDirectPlain.key, MyEntity)).resolves.toBeTruthy();

            // Entity keys should keep either the id or name properly set between calls to the datastore
            const e2 = new MyEntity({
                key: Key.nameKey('MyEntity', '789456123-parent', undefined, Key.nameKey('MyGroupKey', '789456123-gp')),
                text: 'bonjour',
                number: 5678,
                child_key: Key.nameKey('MyChildEntity', '789456123-child', undefined, Key.nameKey('MyGroupKey', '789456123-gp')),
            });
            const e3 = new MyEntity({
                key: Key.idKey('MyEntity', 789456123, undefined, Key.idKey('MyGroupKey', 789456123)),
                text: 'bonjour',
                number: 5678,
                child_key: Key.idKey('MyChildEntity', 789456123, undefined, Key.idKey('MyGroupKey', 789456123)),
            });

            // Before datastore call
            expect(e2.key.id).toBeUndefined();
            expect(e2.key.name).toBeTruthy();
            expect(e2.child_key.id).toBeUndefined();
            expect(e2.child_key.name).toBeTruthy();
            expect(e3.key.id).toBeGreaterThan(0);
            expect(e3.key.name).toBeUndefined();
            expect(e3.child_key.id).toBeGreaterThan(0);
            expect(e3.child_key.name).toBeUndefined();

            // After datastore call
            await clt.saveMulti([e2, e3]);
            expect(e2.key.id).toBeUndefined();
            expect(e2.key.name).toBeTruthy();
            expect(e2.child_key.id).toBeUndefined();
            expect(e2.child_key.name).toBeTruthy();
            expect(e3.key.id).toBeGreaterThan(0);
            expect(e3.key.name).toBeUndefined();
            expect(e3.child_key.id).toBeGreaterThan(0);
            expect(e3.child_key.name).toBeUndefined();

            // Data from datastore get call
            const e2DsGet = await clt.get(e2.key, MyEntity);
            const e3DsGet = await clt.get(e3.key, MyEntity);
            expect(e2DsGet.key.id).toBeUndefined();
            expect(e2DsGet.key.name).toBeTruthy();
            expect(e2DsGet.child_key.id).toBeUndefined();
            expect(e2DsGet.child_key.name).toBeTruthy();
            expect(e3DsGet.key.id).toBeGreaterThan(0);
            expect(e3DsGet.key.name).toBeUndefined();
            expect(e3DsGet.child_key.id).toBeGreaterThan(0);
            expect(e3DsGet.child_key.name).toBeUndefined();

            // Data from datastore get multi call
            const eRes = await clt.getMulti([e2.key, e3.key], MyEntity);
            expect(eRes[0].key.id).toBeUndefined();
            expect(eRes[0].key.name).toBeTruthy();
            expect(eRes[0].child_key.id).toBeUndefined();
            expect(eRes[0].child_key.name).toBeTruthy();
            expect(eRes[1].key.id).toBeGreaterThan(0);
            expect(eRes[1].key.name).toBeUndefined();
            expect(eRes[1].child_key.id).toBeGreaterThan(0);
            expect(eRes[1].child_key.name).toBeUndefined();
        });

        it('should serialize and deserialize complex entities consistently', async () => {
            @Exclude()
            class MyInnerEntity extends Entity {
                @Persist()
                info_text?: string;

                @Persist()
                info_number?: number;

                @PersistStruct(() => GeoPt)
                info_location?: GeoPt;

                @PersistKey()
                info_key?: Key;

                constructor(props?: Partial<MyInnerEntity>) {
                    super(props && props.key);
                    Object.assign(this, props);
                }
            }

            @Exclude()
            class MyEntity extends Entity {
                @Persist()
                text?: string;

                @Persist()
                number?: number;

                @Persist()
                details?: string[];

                @PersistStruct(() => GeoPt)
                location?: GeoPt;

                @PersistKey()
                child_key?: Key;

                @PersistStruct(() => MyInnerEntity)
                inner?: MyInnerEntity;

                @PersistStruct(() => MyInnerEntity)
                inners?: MyInnerEntity[];

                constructor(props?: Partial<MyEntity>) {
                    super(props && props.key);
                    Object.assign(this, props);
                }
            }

            const e1 = new MyEntity({
                key: Key.idKey('MyEntity', 1234, 'subspace', Key.nameKey('MyParentEntity', '1234-parent', 'subspace')),
                text: 'hello',
                number: 5678,
                details: ['d1', 'd2', 'd3'],
                location: new GeoPt(43.1, 2.3),
                child_key: Key.nameKey('MyChildEntity', '1234-child'),
                inner: new MyInnerEntity({
                    key: Key.nameKey('MyInnerEntity', '1234-inner'),
                    info_text: '',
                    info_number: 0,
                    info_location: new GeoPt(0, 0),
                }),
                inners: [
                    new MyInnerEntity({
                        key: Key.nameKey('MyInnerEntity', '1234-inner-1'),
                        info_text: 'inner-1',
                        info_number: 1,
                        info_location: new GeoPt(1.1, 1.2),
                    }),
                    new MyInnerEntity({
                        key: Key.nameKey('MyInnerEntity', '1234-inner-2'),
                        info_text: 'inner-2',
                        info_number: 2,
                        info_location: new GeoPt(2.1, 2.2),
                    }),
                ],
            });

            // Verify entity is ready to be saved into datastore
            const e1ToDs = e1.toDatastore();
            expect(e1ToDs).toEqual({
                'key': new datastore.Key({ path: ['MyParentEntity', '1234-parent', 'MyEntity', 1234], namespace: 'subspace' }),
                'data': {
                    'text': 'hello',
                    'number': 5678,
                    'details': ['d1', 'd2', 'd3'],
                    'location': clt.datastoreClient.geoPoint({ latitude: 43.1, longitude: 2.3 }),
                    'child_key': new datastore.Key({ path: ['MyChildEntity', '1234-child'] }),
                    'inner': {
                        'key': new datastore.Key({ path: ['MyInnerEntity', '1234-inner'] }),
                        'info_text': '',
                        'info_number': 0,
                        'info_location': clt.datastoreClient.geoPoint({ latitude: 0, longitude: 0 }),
                    },
                    'inners': [
                        {
                            'key': new datastore.Key({ path: ['MyInnerEntity', '1234-inner-1'] }),
                            'info_text': 'inner-1',
                            'info_number': 1,
                            'info_location': clt.datastoreClient.geoPoint({ latitude: 1.1, longitude: 1.2 }),
                        },
                        {
                            'key': new datastore.Key({ path: ['MyInnerEntity', '1234-inner-2'] }),
                            'info_text': 'inner-2',
                            'info_number': 2,
                            'info_location': clt.datastoreClient.geoPoint({ latitude: 2.1, longitude: 2.2 }),
                        },
                    ],
                },
                'excludeFromIndexes': [],
            });

            // Verify entity cannot be restored until saved into datastore
            expect(() => {
                MyEntity.fromDatastore(e1ToDs, MyEntity);
            }).toThrow(Error);

            // Save entity into datastore
            await clt.datastoreClient.save(e1ToDs);

            // Verify entity from datastore can be restored into model
            const [e1RawDs] = await clt.datastoreClient.get(e1ToDs.key);
            const e1FromDs = MyEntity.fromDatastore(e1RawDs, MyEntity);
            expect(JSON.stringify(DataUtils.sortJSON(classToClass(e1FromDs)))).toEqual(JSON.stringify(DataUtils.sortJSON(classToClass(e1))));

            // Verify entity is ready to be saved into cache as JSON
            const e1ToPlain = await e1.toPlain(clt.datastoreClient);
            expect(e1ToPlain).toEqual({
                'key': await e1.key?.encode(clt.datastoreClient),
                'text': 'hello',
                'number': 5678,
                'details': ['d1', 'd2', 'd3'],
                'location': { 'latitude': 43.1, 'longitude': 2.3 },
                'child_key': await e1.child_key?.encode(clt.datastoreClient),
                'inner': {
                    'key': await e1.inner?.key?.encode(clt.datastoreClient),
                    'info_text': '',
                    'info_number': 0,
                    'info_location': { 'latitude': 0, 'longitude': 0 },
                },
                'inners': [
                    {
                        'key': e1.inners && e1.inners[0] && (await e1.inners[0].key?.encode(clt.datastoreClient)),
                        'info_text': 'inner-1',
                        'info_number': 1,
                        'info_location': { 'latitude': 1.1, 'longitude': 1.2 },
                    },
                    {
                        'key': e1.inners && e1.inners[1] && (await e1.inners[1].key?.encode(clt.datastoreClient)),
                        'info_text': 'inner-2',
                        'info_number': 2,
                        'info_location': { 'latitude': 2.1, 'longitude': 2.2 },
                    },
                ],
            });

            // Verity entity from plain matches the original entity
            const e1FromPlain = MyEntity.fromPlain(e1ToPlain, MyEntity);
            expect(JSON.stringify(DataUtils.sortJSON(classToClass(e1FromPlain)))).toEqual(JSON.stringify(DataUtils.sortJSON(classToClass(e1))));

            // Class transformer direct use shoul also output consisten results
            const e1FromDirectPlain = plainToClass(MyEntity, classToPlain(e1));
            expect(JSON.stringify(DataUtils.sortJSON(classToClass(e1FromDirectPlain)))).toEqual(JSON.stringify(DataUtils.sortJSON(classToClass(e1))));
            await expect(clt.get(e1FromDirectPlain.key, MyEntity)).resolves.toBeTruthy();
        });

        it('should call entity hooks', async () => {
            @Exclude()
            class MyComputedEntity extends Entity {
                @Persist()
                x?: number;

                @PersistKey()
                y?: number;

                _beforeSaveHook = async () => {
                    this.y = this.x * this.x;
                };

                constructor(props?: Partial<MyComputedEntity>) {
                    super(props && props.key);
                    Object.assign(this, props);
                }
            }

            const e = new MyComputedEntity({ key: Key.incompleteKey('MyComputedEntity'), x: 4 });
            await e._beforeSaveHook();
            expect(e.y).toEqual(e.x * e.x);
            e.x = 12;
            expect(e.y).toEqual(4 * 4);
            await clt.save(e);
            expect(e.y).toEqual(e.x * e.x);
            e.x = 15;
            expect(e.y).toEqual(12 * 12);
            await clt.saveMulti([e]);
            expect(e.y).toEqual(e.x * e.x);
        });
    });
});
