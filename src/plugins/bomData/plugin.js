export default function BOMDataPlugin() {
    return function install(openmct) {
        openmct.objects.addRoot({
            namespace: 'bom.taxonomy',
            key: 'bomData'
        });

        openmct.objects.addProvider('bom.taxonomy', {
            get: function (identifier) {
                if (identifier.key === 'bomData') {
                    return Promise.resolve({
                        identifier: identifier,
                        name: 'BOM Data',
                        type: 'folder',
                        location: 'ROOT'
                    });
                }
            }
        });
    };
}